'use strict';
/* ASE Dispatch — fictional training/demo system. Not suitable for actual emergency dispatch. */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const PORT = Number(process.env.PORT || 3000);
const PUBLIC = path.join(__dirname,'public');
const MAX_USERS = 4;
const sessions = new Map(); // key: secret browser session token
const conversations = new Map();
const mapItems = new Map();
const calls = new Map();
const ALLOWED_STATUS = new Set(['Available','En route','On scene','Busy']);
const ALLOWED_PRIORITY = new Set(['Low','Routine','High','Urgent']);
const ALLOWED_REPORT_STATUS = new Set(['Open','Responding','Resolved']);
const MAX_POST = 9 * 1024 * 1024;
const MAX_MEDIA_BASE64 = 6_500_000;
const uid = () => crypto.randomBytes(9).toString('hex');
const safeText = (x,max=180) => String(x ?? '').trim().slice(0,max);
const fail = (msg,status=400) => { const e = new Error(msg);e.status=status; throw e; };
const now = () => Date.now();
const mime = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.svg':'image/svg+xml','.ico':'image/x-icon'};
function respond(res,status,data){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));}
function send(session,type,payload){
  if(!session || !session.stream || session.stream.destroyed)return;
  try{session.stream.write(`event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`);}catch(_e){}
}
const roster = () => Array.from(sessions.values()).map(s=>({id:s.id,name:s.name,status:s.status,color:s.color,joined:s.joined}));
function broadcastRoster(){for(const s of sessions.values()) send(s,'roster',roster());}
function peerById(id){return Array.from(sessions.values()).find(s=>s.id===id);}
function privateRoom(a,b){return `dm:${[a,b].sort().join(':')}`;}
function allowed(s,room){
  if(room === 'public') return true;
  if(typeof room!=='string'|| !room.startsWith('dm:'))return false;
  const ids=room.slice(3).split(':');
  return ids.length===2 && ids.includes(s.id) && ids.every(id=>Boolean(peerById(id))) && privateRoom(ids[0],ids[1])===room;
}
function occupants(room){return Array.from(sessions.values()).filter(s=>allowed(s,room));}
function emitRoom(room,type,payload){for(const s of occupants(room))send(s,type,payload);}
function cleanupSession(token,reason='disconnected'){
  const s=sessions.get(token);if(!s)return;
  clearTimeout(s.linger);
  sessions.delete(token);
  for(const [id,item] of [...mapItems]){
    if(item.authorId!==s.id)continue;
    mapItems.delete(id);
    emitRoom(item.room,'artifact:remove',{id,room:item.room});
  }
  for(const [id,call] of [...calls]){
    if(call.from===s.id||call.to===s.id){calls.delete(id);const remaining=peerById(call.from===s.id?call.to:call.from);send(remaining,'call:ended',{callId:id,reason});}
  }
  broadcastRoster();
}
function clampCoord(v){const n=Number(v);if(!Number.isFinite(n)||n<0||n>100)fail('Map coordinates must be between 0 and 100.');return Number(n.toFixed(3));}
function checkMedia(media){
  if(!media)return null;
  if(typeof media!=='object')fail('Invalid media.');
  const kind=media.kind;
  if(!['image','video','audio'].includes(kind))fail('Unsupported media kind.');
  const value=String(media.data||'');
  if(value.length>MAX_MEDIA_BASE64)fail('Media is too large. Keep files under about 4 MB.');
  const rx=kind==='image'? /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/ : kind==='video'? /^data:video\/(webm|mp4|quicktime);base64,[A-Za-z0-9+/=]+$/ : /^data:audio\/(webm|mp4|ogg|mpeg|wav);base64,[A-Za-z0-9+/=]+$/;
  if(!rx.test(value))fail('Unsupported media format.');
  return {kind,data:value};
}
function roomFeed(map,room){return map.get(room)||[];}
function addHistory(room,msg){const h=roomFeed(conversations,room);h.push(msg);if(h.length>80)h.splice(0,h.length-80);conversations.set(room,h);}
function stateFor(s,room){if(!allowed(s,room))fail('That conversation is private.',403);return {roster:roster(),room,messages:roomFeed(conversations,room),items:[...mapItems.values()].filter(x=>x.room===room)};}
function requestAction(s,d){
  const action=d.action,room=String(d.room||'public');
  if(['chat','mark','path','report','report:status','artifact:remove'].includes(action)&&!allowed(s,room))fail('You do not belong to that conversation.',403);
  if(action==='status'){
    if(!ALLOWED_STATUS.has(d.status))fail('Invalid unit status');s.status=d.status;broadcastRoster();return {};
  }
  if(action==='chat'){
    const text=safeText(d.text,1500),media=checkMedia(d.media);
    if(!text&&!media)fail('Message cannot be empty.');
    const m={id:uid(),room,authorId:s.id,author:s.name,text,media,ts:now()};
    addHistory(room,m);emitRoom(room,'chat:new',m);return {id:m.id};
  }
  if(action==='mark'){
    const item={id:uid(),kind:'mark',room,authorId:s.id,author:s.name,x:clampCoord(d.x),y:clampCoord(d.y),title:safeText(d.title,90)||'Map mark',details:safeText(d.details,400),ts:now()};
    mapItems.set(item.id,item);emitRoom(room,'artifact:new',item);return {id:item.id};
  }
  if(action==='path'){
    if(!Array.isArray(d.points)||d.points.length<2||d.points.length>40)fail('Paths need 2 to 40 points.');
    const item={id:uid(),kind:'path',room,authorId:s.id,author:s.name,title:safeText(d.title,90)||'Route',points:d.points.map(p=>({x:clampCoord(p.x),y:clampCoord(p.y)})),ts:now()};
    mapItems.set(item.id,item);emitRoom(room,'artifact:new',item);return {id:item.id};
  }
  if(action==='report'){
    const title=safeText(d.title,110),details=safeText(d.details,800);if(!title)fail('Enter a report title.');
    const priority=ALLOWED_PRIORITY.has(d.priority)?d.priority:'Routine';
    const media=checkMedia(d.media);
    const item={id:uid(),kind:'report',room,authorId:s.id,author:s.name,title,details,priority,status:'Open',x:clampCoord(d.x),y:clampCoord(d.y),media,ts:now(),updated:now()};
    mapItems.set(item.id,item);emitRoom(room,'artifact:new',item);return {id:item.id};
  }
  if(action==='report:status'){
    const item=mapItems.get(d.id);if(!item||item.kind!=='report'||item.room!==room)fail('Report not found.',404);
    if(!ALLOWED_REPORT_STATUS.has(d.status))fail('Invalid report status.');
    item.status=d.status;item.updated=now();emitRoom(room,'artifact:update',item);return {};
  }
  if(action==='artifact:remove'){
    const item=mapItems.get(d.id);if(!item||item.room!==room)fail('Item not found.',404);
    if(item.authorId!==s.id)fail('Only the creator can remove this item.',403);
    mapItems.delete(item.id);emitRoom(room,'artifact:remove',{id:item.id,room});return {};
  }
  if(action==='call:invite'){
    const to=peerById(d.to);if(!to||to.id===s.id)fail('That person is not available.');
    const kind=d.kind==='video'?'video':'audio';
    if([...calls.values()].some(c=>[c.from,c.to].includes(s.id)||[c.from,c.to].includes(to.id)))fail('One of these people is already on a call.');
    const call={id:uid(),from:s.id,to:to.id,kind,state:'ringing',ts:now()};calls.set(call.id,call);
    send(to,'call:incoming',{callId:call.id,from:s.id,fromName:s.name,kind});
    return {callId:call.id};
  }
  if(['call:accept','call:decline','call:end','call:signal'].includes(action)){
    const call=calls.get(d.callId);if(!call||![call.from,call.to].includes(s.id))fail('Call not found.',404);
    const other=peerById(s.id===call.from?call.to:call.from);
    if(action==='call:accept'){
      if(s.id!==call.to||call.state!=='ringing')fail('Call cannot be accepted.');
      call.state='active';const payload={callId:call.id,kind:call.kind,from:call.from,to:call.to};send(other,'call:active',payload);send(s,'call:active',payload);return {};
    }
    if(action==='call:decline'){
      if(s.id!==call.to||call.state!=='ringing')fail('Call cannot be declined.');
      calls.delete(call.id);send(other,'call:declined',{callId:call.id});return {};
    }
    if(action==='call:end'){
      calls.delete(call.id);send(other,'call:ended',{callId:call.id,reason:'ended'});return {};
    }
    if(action==='call:signal'){
      if(call.state!=='active')fail('Call has not been answered.');
      if(!d.signal||typeof d.signal!=='object')fail('Invalid signaling message.');
      const serialized=JSON.stringify(d.signal);if(serialized.length>16000)fail('Signal too long.');
      send(other,'call:signal',{callId:call.id,signal:d.signal});return {};
    }
  }
  fail('Unknown action.');
}
function parseJson(req){return new Promise((resolve,reject)=>{
  let total=0,parts=[];req.on('data',ch=>{total+=ch.length;if(total>MAX_POST){reject(Object.assign(new Error('Upload too large.'),{status:413}));req.destroy();return;}parts.push(ch)});
  req.on('end',()=>{try{resolve(JSON.parse(Buffer.concat(parts).toString('utf8')))}catch(e){reject(Object.assign(new Error('Invalid JSON.'),{status:400}));}});
  req.on('error',reject);
});}
function getSession(url,req,body){const token=body?.token||url.searchParams.get('token')||req.headers['x-session'];const s=sessions.get(token);if(!s)fail('Session expired. Join again.',401);return s;}
function serveFile(req,res,pathname){
  let p=pathname==='/'?'/index.html':pathname;
  if(p.includes('\\')||p.includes('\0')){res.writeHead(400);return res.end();}
  const f=path.resolve(PUBLIC,'.'+p);
  if(f!==PUBLIC&&!f.startsWith(PUBLIC+path.sep)){res.writeHead(403);return res.end();}
  fs.stat(f,(err,stat)=>{
    if(err||!stat.isFile()){res.writeHead(404,{'Content-Type':'text/plain; charset=utf-8'});return res.end('Not Found');}
    res.writeHead(200,{'Content-Type':mime[path.extname(f)]||'application/octet-stream','Cache-Control':p.startsWith('/assets/')?'public, max-age=3600':'no-cache','X-Content-Type-Options':'nosniff'});
    fs.createReadStream(f).pipe(res);
  });
}
const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url||'/',`http://${req.headers.host||'localhost'}`);
  try{
    if(req.method==='GET'&&url.pathname==='/health')return respond(res,200,{status:'ok',application:'ASE Dispatch Demo',connected:sessions.size,max:MAX_USERS});
    if(req.method==='POST'&&url.pathname==='/api/join'){
      const body=await parseJson(req),name=safeText(body.name,22).replace(/[<>]/g,'');
      if(name.length<2)fail('Enter a name with at least 2 characters.');
      if([...sessions.values()].some(s=>s.name.toLowerCase()===name.toLowerCase()))fail('That name is already in use.');
      if(sessions.size>=MAX_USERS)fail('All four slots are currently occupied.');
      const token=crypto.randomBytes(24).toString('hex');
      const s={token,id:uid(),name,status:'Available',joined:now(),stream:null,linger:null};sessions.set(token,s);
      respond(res,200,{ok:true,token,id:s.id,name,roster:roster(),capacity:MAX_USERS});broadcastRoster();return;
    }
    if(req.method==='GET'&&url.pathname==='/api/events'){
      const s=getSession(url,req);clearTimeout(s.linger);
      if(s.stream&&!s.stream.destroyed)try{s.stream.end()}catch(_e){}
      res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-cache, no-transform','Connection':'keep-alive','X-Accel-Buffering':'no'});
      s.stream=res;res.write(': connected\n\n');send(s,'roster',roster());
      const ping=setInterval(()=>{if(!res.destroyed)try{res.write(': ping\n\n')}catch(_){}},15000);
      res.on('close',()=>{clearInterval(ping);if(s.stream===res){s.stream=null;clearTimeout(s.linger);s.linger=setTimeout(()=>cleanupSession(s.token),3500);}});
      return;
    }
    if(req.method==='GET'&&url.pathname==='/api/state'){
      const s=getSession(url,req),room=url.searchParams.get('room')||'public';return respond(res,200,{ok:true,...stateFor(s,room)});
    }
    if(req.method==='POST'&&url.pathname==='/api/action'){
      const body=await parseJson(req),s=getSession(url,req,body);
      const result=requestAction(s,body);return respond(res,200,{ok:true,...result});
    }
    if(req.method==='POST'&&url.pathname==='/api/leave'){
      const body=await parseJson(req),s=getSession(url,req,body);cleanupSession(s.token,'left');return respond(res,200,{ok:true});
    }
    if(req.method==='GET')return serveFile(req,res,decodeURIComponent(url.pathname));
    respond(res,405,{error:'Method not allowed'});
  }catch(e){if(!res.headersSent)respond(res,e.status||500,{ok:false,error:e.message||'Server error'});}
});
server.listen(PORT,'0.0.0.0',()=>console.log(`ASE Dispatch demo running at http://localhost:${PORT}`));
