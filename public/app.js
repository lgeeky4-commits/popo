'use strict';
/* ASE Dispatch prototype, not a real emergency-response system. */
const $=id=>document.getElementById(id);
const $all=q=>Array.from(document.querySelectorAll(q));
const state={token:null,id:null,name:null,roster:[],room:'public',peerId:null,messages:[],items:[],mode:'inspect',draftPath:[],reportFilter:'all',pendingPoint:null,pendingForm:'mark',attachment:null,reportMedia:null,cameraTarget:'report',cameraStream:null,facing:'environment',cameraRecorder:null,recordTimer:null,sse:null,call:null,incoming:null,localStream:null,pc:null,remoteCandidates:[],talkHeld:false,talkRecorder:null,talkStream:null,toastTimer:null,grid:true};
const make=(tag,cls='',text='')=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text)e.textContent=text;return e;};
const clamp=(v,min,max)=>Math.min(max,Math.max(min,v));
const strDate=ms=>new Date(ms).toLocaleString([],{month:'short',day:'2-digit',hour:'2-digit',minute:'2-digit'});
const shortTime=ms=>new Date(ms).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
function toast(message){const e=$('toast');e.textContent=message;e.hidden=false;clearTimeout(state.toastTimer);state.toastTimer=setTimeout(()=>e.hidden=true,3800);}
function safeError(e){return (e&&e.message)||'Something went wrong.';}
async function httpJson(url,body){const r=await fetch(url,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined,cache:'no-store'});const j=await r.json();if(!r.ok||j.ok===false)throw new Error(j.error||'Request failed');return j;}
const action=(name,extra={})=>httpJson('/api/action',{token:state.token,action:name,...extra});
function roomName(){if(state.room==='public')return 'Public Dispatch';return `Private / ${state.roster.find(s=>s.id===state.peerId)?.name||'Unavailable'}`;}
function isPublic(){return state.room==='public';}
function setView(view){$('app').dataset.view=view;$all('.mobile-tab').forEach(b=>b.classList.toggle('active',b.dataset.tab===view));}
function themeInit(){
  let data;try{data=JSON.parse(localStorage.getItem('ase-dispatch-display')||'{}')}catch{data={}}
  $('themeSelect').value=['navy','red','graphite','green'].includes(data.theme)?data.theme:'navy';
  for(const [field,def] of [['brightness',100],['contrast',100],['saturation',100],['hue',0]]){$(`${field}Slider`).value=Number.isFinite(Number(data[field]))?data[field]:def;}
  applyTheme();
}
function applyTheme(){
  const t=$('themeSelect').value;document.body.classList.remove('theme-red','theme-graphite','theme-green');if(t!=='navy')document.body.classList.add(`theme-${t}`);
  const vals={theme:t};for(const field of ['brightness','contrast','saturation','hue']){const n=Number($(`${field}Slider`).value);vals[field]=n;$(`${field}Value`).textContent=`${n}${field==='hue'?'°':'%'}`;}
  document.documentElement.style.setProperty('--ui-bright',vals.brightness/100);document.documentElement.style.setProperty('--ui-contrast',vals.contrast/100);document.documentElement.style.setProperty('--ui-sat',vals.saturation/100);document.documentElement.style.setProperty('--ui-hue',`${vals.hue}deg`);
  localStorage.setItem('ase-dispatch-display',JSON.stringify(vals));
}
function updateClock(){const now=new Date();$('clock').textContent=now.toLocaleTimeString([],{hour12:false});}
function selectedPeer(){return state.roster.find(u=>u.id===state.peerId);}
function renderRoster(){
  $('countLabel').textContent=`${state.roster.length}/4`;
  $('slotGrid').querySelectorAll('span').forEach((e,i)=>e.classList.toggle('filled',i<state.roster.length));
  const list=$('unitList');list.replaceChildren();
  const sorted=[...state.roster].sort((a,b)=>a.joined-b.joined);
  sorted.forEach((u,i)=>{
    const b=make('button','unit-button');b.type='button';b.classList.toggle('selected',state.peerId===u.id);
    const avatar=make('span','unit-avatar',String(i+1).padStart(2,'0'));
    const text=make('span','unit-text');text.append(make('b','',u.name+(u.id===state.id?' / YOU':'')),make('small','',u.status));
    b.append(avatar,text,make('span','unit-online'));
    if(u.id===state.id){b.disabled=true;b.title='Your own unit';}else{b.title=`Private chat with ${u.name}`;b.addEventListener('click',()=>changeRoom(u.id));}
    list.append(b);
  });
  for(let i=sorted.length;i<4;i++)list.append(make('div','unit-placeholder',`SLOT ${String(i+1).padStart(2,'0')} · AWAITING UNIT`));
  $('publicRoomButton').classList.toggle('selected',isPublic());
  $('callAudioButton').disabled=isPublic()||!selectedPeer();$('callVideoButton').disabled=isPublic()||!selectedPeer();
  const my=state.roster.find(u=>u.id===state.id);if(my)$('statusSelect').value=my.status;
}
function applyRoomLabels(){
  $('chatTitle').textContent=roomName();$('chatSubtitle').textContent=isPublic()?'Shared room · all connected units':'One-to-one conversation · private map';
  $('mapScopeLabel').textContent=isPublic()?'PUBLIC':'DIRECT';
  $('roomScope').textContent=isPublic()?'SCOPE: PUBLIC / 4 UNITS':'SCOPE: PRIVATE / 2 UNITS';
  $('publicRoomButton').classList.toggle('selected',isPublic());
  renderRoster();
}
async function changeRoom(peerId=null){
  if(!state.token)return;
  if(peerId&& !state.roster.some(u=>u.id===peerId)){toast('That unit has disconnected.');return;}
  state.peerId=peerId;state.room=peerId?`dm:${[state.id,peerId].sort().join(':')}`:'public';state.mode='inspect';state.draftPath=[];state.attachment=null;showAttachment();
  setMode('inspect');applyRoomLabels();
  try{const data=await httpJson(`/api/state?token=${encodeURIComponent(state.token)}&room=${encodeURIComponent(state.room)}`);state.messages=data.messages;state.items=data.items;renderMessages();renderMap();renderReports();}
  catch(e){toast(safeError(e));if(peerId)changeRoom(null);}
  if(matchMedia('(max-width:760px)').matches)setView('chat');
}
function connectEvents(){
  if(state.sse)state.sse.close();const es=new EventSource(`/api/events?token=${encodeURIComponent(state.token)}`);state.sse=es;
  es.addEventListener('roster',ev=>{
    const oldPeer=state.peerId;state.roster=JSON.parse(ev.data);renderRoster();
    if(oldPeer&&!state.roster.some(u=>u.id===oldPeer)){toast('Private unit disconnected. Returning to public dispatch.');changeRoom(null);}
    $('connectionText').textContent=`ONLINE / ${state.roster.length} OF 4`;
    document.querySelector('.network-dot').classList.add('online');
  });
  es.addEventListener('chat:new',ev=>{const msg=JSON.parse(ev.data);if(msg.room===state.room){state.messages.push(msg);if(state.messages.length>80)state.messages.shift();renderMessages();}});
  es.addEventListener('artifact:new',ev=>{const a=JSON.parse(ev.data);if(a.room===state.room){state.items.push(a);renderMap();renderReports();}});
  es.addEventListener('artifact:update',ev=>{const a=JSON.parse(ev.data);if(a.room===state.room){const i=state.items.findIndex(x=>x.id===a.id);if(i>=0)state.items[i]=a;renderMap();renderReports();if($('detailOverlay').hidden===false&&$('detailOverlay').dataset.id===a.id)showDetails(a.id);}});
  es.addEventListener('artifact:remove',ev=>{const a=JSON.parse(ev.data);if(a.room===state.room){state.items=state.items.filter(x=>x.id!==a.id);renderMap();renderReports();if($('detailOverlay').dataset.id===a.id)$('detailOverlay').hidden=true;}});
  es.addEventListener('call:incoming',ev=>onCallIncoming(JSON.parse(ev.data)));
  es.addEventListener('call:active',ev=>onCallActive(JSON.parse(ev.data)));
  es.addEventListener('call:declined',()=>{toast('Call was declined.');cleanupCall();});
  es.addEventListener('call:ended',()=>{toast('Call ended.');cleanupCall();});
  es.addEventListener('call:signal',ev=>onCallSignal(JSON.parse(ev.data)));
  es.onopen=()=>{document.querySelector('.network-dot').classList.add('online');};
  es.onerror=()=>{$('connectionText').textContent='RECONNECTING';document.querySelector('.network-dot').classList.remove('online');};
}
async function join(){
  const name=$('joinName').value.trim();$('joinButton').disabled=true;$('joinError').textContent='';
  try{
    const j=await httpJson('/api/join',{name});state.token=j.token;state.id=j.id;state.name=j.name;state.roster=j.roster;
    $('joinScreen').hidden=true;$('app').hidden=false;$('mobileNav').hidden=false;$('leaveButton').hidden=false;
    connectEvents();renderRoster();setView('chat');await changeRoom(null);toast(`Connected as ${state.name}`);
  }catch(e){$('joinError').textContent=safeError(e);}finally{$('joinButton').disabled=false;}
}
async function leave(){if(!state.token)return;const token=state.token;cleanupCall(false);closeCamera();try{await httpJson('/api/leave',{token});}catch(_){}state.sse?.close();state.token=null;location.reload();}
function renderMessages(){
  const area=$('messages');area.replaceChildren();if(!state.messages.length){area.append(make('div','empty-message','SECURE-STYLE DEMO CHAT / NO MESSAGES YET'));return;}
  state.messages.forEach(m=>{
    const el=make('article',`message${m.authorId===state.id?' self':''}`);const by=make('div','message-byline');by.append(make('span','',m.author),make('time','',shortTime(m.ts)));const bubble=make('div','message-bubble');
    if(m.text)bubble.append(document.createTextNode(m.text));
    if(m.media){const holder=make('div','msg-media');const media=buildMedia(m.media);if(media)holder.append(media);bubble.append(holder);}el.append(by,bubble);area.append(el);
  });area.scrollTop=area.scrollHeight;
}
function buildMedia(media){if(!media||!media.data)return null;let el;if(media.kind==='image'){el=make('img');el.alt='Shared image';}else if(media.kind==='video'){el=make('video');el.controls=true;el.playsInline=true;}else if(media.kind==='audio'){el=make('audio');el.controls=true;}else return null;el.src=media.data;el.preload='metadata';return el;}
function showAttachment(){const pane=$('attachmentPreview');pane.replaceChildren();pane.hidden=!state.attachment;if(!state.attachment)return;pane.append(make('span','',`ATTACHED ${state.attachment.kind.toUpperCase()}`));const media=buildMedia(state.attachment);if(media)pane.append(media);const x=make('button','','REMOVE');x.addEventListener('click',()=>{state.attachment=null;showAttachment();});pane.append(x);}
async function sendChat(){const text=$('chatInput').value.trim();if(!text&&!state.attachment)return;
  $('sendButton').disabled=true;$('chatStatus').textContent='SENDING...';
  try{await action('chat',{room:state.room,text,media:state.attachment});$('chatInput').value='';state.attachment=null;showAttachment();$('chatStatus').textContent='SENT';}
  catch(e){toast(safeError(e));$('chatStatus').textContent='FAILED';}finally{$('sendButton').disabled=false;}
}
function setMode(mode){state.mode=mode;state.draftPath=[];$all('.maptool[data-mode]').forEach(b=>b.classList.toggle('active',b.dataset.mode===mode));$('finishPath').hidden=mode!=='path';$('cancelPath').hidden=mode!=='path';const texts={inspect:'VIEW — TAP A MARKER TO INSPECT',mark:'MARK — TAP MAP TO ADD A NOTE',path:'PATH — TAP TO ADD POINTS; FINISH WHEN DONE',report:'REPORT — TAP MAP TO PLACE AN INCIDENT'};$('mapInstruction').textContent=texts[mode];renderMap();}
function stageCoords(event){const r=$('mapBoard').getBoundingClientRect();return {x:clamp((event.clientX-r.left)/r.width*100,0,100),y:clamp((event.clientY-r.top)/r.height*100,0,100)};}
function onMapClick(ev){
  if(ev.target.closest('.map-pin'))return;
  const p=stageCoords(ev);
  if(state.mode==='inspect')return;
  if(state.mode==='path'){state.draftPath.push(p);renderMap();return;}
  state.pendingPoint=p;state.pendingForm=state.mode==='mark'?'mark':'report';openForm();
}
function openForm(){
  $('formTitle').textContent=state.pendingForm==='mark'?'NEW MAP MARK':'NEW INCIDENT REPORT';
  const p=state.pendingPoint;$('formCoords').textContent=`REFERENCE POSITION X ${p.x.toFixed(1)} / Y ${p.y.toFixed(1)}`;
  $('formName').value='';$('formDetails').value='';$('reportExtras').hidden=state.pendingForm!=='report';$('formPriority').value='Routine';state.reportMedia=null;previewReportMedia();$('formOverlay').hidden=false;$('formName').focus();
}
async function saveForm(){const title=$('formName').value.trim(),details=$('formDetails').value.trim();if(!title)return toast('Enter a title.');$('formSave').disabled=true;
  try{const p=state.pendingPoint;if(state.pendingForm==='mark')await action('mark',{room:state.room,...p,title,details});else await action('report',{room:state.room,...p,title,details,priority:$('formPriority').value,media:state.reportMedia});$('formOverlay').hidden=true;state.reportMedia=null;setMode('inspect');toast(state.pendingForm==='mark'?'Map mark saved.':'Incident report shared to this conversation.');}
  catch(e){toast(safeError(e));}finally{$('formSave').disabled=false;}
}
async function finishPath(){if(state.draftPath.length<2)return toast('Add at least two path points.');const title=prompt('Route name','Patrol route')||'Patrol route';try{await action('path',{room:state.room,points:state.draftPath,title});setMode('inspect');toast('Route shared with this conversation.');}catch(e){toast(safeError(e));}}
function mapPin(item){const b=make('button',`map-pin ${item.kind==='report'?'report':''} ${item.priority==='Urgent'?'urgent':''}`);b.type='button';b.style.left=`${item.x}%`;b.style.top=`${item.y}%`;b.title=`${item.title} — ${item.author}`;b.append(make('span','pin-label',item.title.slice(0,17)),make('span','pin-head',item.kind==='report'?'!':'•'));b.addEventListener('click',ev=>{ev.stopPropagation();showDetails(item.id);});return b;}
function renderMap(){
  const pinLayer=$('markerLayer'),paths=$('pathLayer');pinLayer.replaceChildren();paths.replaceChildren();
  const items=state.items;
  const makeSvg=(type,attrs)=>{const e=document.createElementNS('http://www.w3.org/2000/svg',type);for(const [k,v] of Object.entries(attrs))e.setAttribute(k,String(v));return e;};
  items.filter(i=>i.kind==='path').forEach((i,idx)=>{
    const path=makeSvg('polyline',{points:i.points.map(p=>`${p.x},${p.y}`).join(' '),fill:'none',stroke:idx%2?'#ffd28a':'#67ddf6','stroke-width':'.7','stroke-dasharray':'1.6 1','vector-effect':'non-scaling-stroke'});path.style.pointerEvents='stroke';path.style.cursor='pointer';path.addEventListener('click',ev=>{ev.stopPropagation();showDetails(i.id);});paths.append(path);
    i.points.forEach((p,index)=>paths.append(makeSvg('circle',{cx:p.x,cy:p.y,r:index===0||index===i.points.length-1?'.9':'.45',fill:'#e9fbff',stroke:'#1f405b','stroke-width':'.3'})));
  });
  if(state.draftPath.length){paths.append(makeSvg('polyline',{points:state.draftPath.map(p=>`${p.x},${p.y}`).join(' '),fill:'none',stroke:'#f6dd8b','stroke-width':'.85','stroke-dasharray':'1 1'}));state.draftPath.forEach(p=>paths.append(makeSvg('circle',{cx:p.x,cy:p.y,r:'.7',fill:'#ffd17e'})));}
  items.filter(i=>i.kind!=='path').forEach(i=>pinLayer.append(mapPin(i)));
  $('markCount').textContent=String(items.filter(i=>i.kind==='mark').length).padStart(2,'0');$('routeCount').textContent=String(items.filter(i=>i.kind==='path').length).padStart(2,'0');
  $('bottomReportCount').textContent=String(items.filter(i=>i.kind==='report').length).padStart(2,'0');
}
function renderReports(){const reports=state.items.filter(i=>i.kind==='report').sort((a,b)=>b.ts-a.ts);
  $('reportCount').textContent=String(reports.length).padStart(2,'0');
  const list=$('reportList');list.replaceChildren();const shown=reports.filter(i=>state.reportFilter==='all'||state.reportFilter===i.status);
  if(!shown.length){list.append(make('p','empty-reports','No reports match this view.'));return;}
  for(const r of shown){const b=make('button','report-card');b.type='button';const kick=make('div','report-kicker');kick.append(make('span',`priority ${r.priority}`,r.priority.toUpperCase()),make('span','',strDate(r.ts)));b.append(kick,make('h3','',r.title),make('p','',(r.details||'No additional description.').slice(0,130)));const foot=make('div','report-foot');foot.append(make('span','',`${r.author} · ${r.media?r.media.kind.toUpperCase():'TEXT'}`),make('span',`report-status ${r.status}`,r.status.toUpperCase()));b.append(foot);b.addEventListener('click',()=>showDetails(r.id));list.append(b);}
}
function showDetails(id){
  const item=state.items.find(i=>i.id===id);if(!item)return toast('This map item is no longer available.');
  $('detailOverlay').dataset.id=id;$('detailTitle').textContent=item.kind==='report'?'INCIDENT REPORT':item.kind==='path'?'PATROL ROUTE':'MAP MARK';
  $('detailMeta').textContent=`${item.author} / ${strDate(item.ts)} / ${item.kind==='path'?item.points.length+' POINTS':`X ${item.x.toFixed(1)} · Y ${item.y.toFixed(1)}`}`;
  const txt=$('detailText');txt.replaceChildren();txt.append(make('h3','',item.title));if(item.details)txt.append(make('p','',item.details));if(item.kind==='report'){txt.append(make('p','',`PRIORITY: ${item.priority.toUpperCase()}`));}
  const holder=$('detailMedia');holder.replaceChildren();if(item.media){const m=buildMedia(item.media);if(m)holder.append(m);}
  $('detailStatusArea').hidden=item.kind!=='report';$('detailStatus').value=item.status||'Open';$('detailRemove').hidden=item.authorId!==state.id;$('detailOverlay').hidden=false;
}
async function updateDetailStatus(){const id=$('detailOverlay').dataset.id;try{await action('report:status',{room:state.room,id,status:$('detailStatus').value});toast('Report status updated.');}catch(e){toast(safeError(e));}}
async function removeDetail(){const id=$('detailOverlay').dataset.id;if(!confirm('Remove this item from the map?'))return;try{await action('artifact:remove',{room:state.room,id});$('detailOverlay').hidden=true;toast('Map item removed.');}catch(e){toast(safeError(e));}}
function previewReportMedia(){const pane=$('reportMediaPreview');pane.replaceChildren();pane.hidden=!state.reportMedia;if(state.reportMedia){pane.append(make('strong','','ATTACHED MEDIA'));const el=buildMedia(state.reportMedia);if(el)pane.append(el);const rm=make('button','secondary-button','REMOVE MEDIA');rm.addEventListener('click',()=>{state.reportMedia=null;previewReportMedia();});pane.append(rm);}}
function blobToDataUrl(blob){return new Promise((resolve,reject)=>{const f=new FileReader();f.onload=()=>resolve(f.result);f.onerror=reject;f.readAsDataURL(blob);});}
function imageToJpeg(file){return new Promise((resolve,reject)=>{
  const url=URL.createObjectURL(file),image=new Image();image.onload=()=>{try{const max=1280,scale=Math.min(1,max/Math.max(image.width,image.height));const c=document.createElement('canvas');c.width=Math.max(1,Math.round(image.width*scale));c.height=Math.max(1,Math.round(image.height*scale));c.getContext('2d').drawImage(image,0,0,c.width,c.height);const data=c.toDataURL('image/jpeg',.76);URL.revokeObjectURL(url);resolve({kind:'image',data});}catch(e){URL.revokeObjectURL(url);reject(e);}};image.onerror=()=>{URL.revokeObjectURL(url);reject(new Error('Could not read this image.'));};image.src=url;
});}
async function mediaFromFile(file,kindLimit='any'){
  if(!file)throw new Error('Select a file.');let kind=file.type.startsWith('image/')?'image':file.type.startsWith('video/')?'video':file.type.startsWith('audio/')?'audio':null;
  if(!kind || (kindLimit==='report'&&kind==='audio'))throw new Error('Choose an image or video file.');
  if(kind==='image')return imageToJpeg(file);
  if(file.size>4_000_000)throw new Error('Video/audio must be under 4 MB. Choose a shorter recording.');
  const result={kind,data:await blobToDataUrl(file)};
  if(!/^data:(video\/(webm|mp4|quicktime)|audio\/(webm|mp4|ogg|mpeg|wav));base64,/i.test(result.data))throw new Error('That file format is not supported.');
  return result;
}
async function onFileChosen(ev,target){const file=ev.target.files?.[0];if(!file)return;try{const m=await mediaFromFile(file,target==='report'?'report':'any');if(target==='report'){state.reportMedia=m;previewReportMedia();}else{state.attachment=m;showAttachment();}}catch(e){toast(safeError(e));}ev.target.value='';}
async function openCamera(target){state.cameraTarget=target;$('cameraOverlay').hidden=false;state.facing='environment';await startCamera();}
async function startCamera(){
  closeCameraStream();$('cameraHint').textContent='Requesting camera permission...';
  if(!navigator.mediaDevices?.getUserMedia){$('cameraHint').textContent='This browser does not support in-page camera capture.';return;}
  const v={facingMode:{ideal:state.facing}};
  try{state.cameraStream=await navigator.mediaDevices.getUserMedia({video:v,audio:true});}
  catch(e){try{state.cameraStream=await navigator.mediaDevices.getUserMedia({video:v,audio:false});}catch(err){$('cameraHint').textContent=`Camera unavailable: ${safeError(err)}`;return;}}
  $('cameraPreview').srcObject=state.cameraStream;$('cameraPreview').play().catch(()=>{});$('cameraHint').textContent='Take a photo or record a short clip (maximum 8 seconds).';
}
function closeCameraStream(){if(state.cameraRecorder?.state==='recording')try{state.cameraRecorder.stop()}catch(_){}state.cameraRecorder=null;clearTimeout(state.recordTimer);if(state.cameraStream){state.cameraStream.getTracks().forEach(t=>t.stop());state.cameraStream=null;}$('cameraPreview').srcObject=null;$('cameraStop').disabled=true;$('cameraRecord').disabled=false;}
function closeCamera(){closeCameraStream();$('cameraOverlay').hidden=true;}
function storeCameraResult(m){if(state.cameraTarget==='report'){state.reportMedia=m;previewReportMedia();}else{state.attachment=m;showAttachment();}closeCamera();toast('Captured in the browser. Attach it when you save or send.');}
function snapshot(){const v=$('cameraPreview');if(!state.cameraStream||!v.videoWidth)return toast('Camera is not ready.');const c=$('snapshotCanvas');const scale=Math.min(1,1280/Math.max(v.videoWidth,v.videoHeight));c.width=Math.max(1,Math.floor(v.videoWidth*scale));c.height=Math.max(1,Math.floor(v.videoHeight*scale));c.getContext('2d').drawImage(v,0,0,c.width,c.height);storeCameraResult({kind:'image',data:c.toDataURL('image/jpeg',.75)});}
function supportedRecorderType(video=false){if(!window.MediaRecorder)return null;const choices=video?['video/webm;codecs=vp8,opus','video/webm','video/mp4']:['audio/webm;codecs=opus','audio/webm','audio/mp4'];return choices.find(t=>MediaRecorder.isTypeSupported(t))||'';}
function startClip(){if(!state.cameraStream)return toast('Camera is not ready.');if(!window.MediaRecorder)return toast('This browser cannot record video.');
  try{const type=supportedRecorderType(true),r= new MediaRecorder(state.cameraStream,type?{mimeType:type}:undefined),chunks=[];state.cameraRecorder=r;
    r.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};r.onstop=async()=>{if(state.cameraRecorder!==r)return;const blob=new Blob(chunks,{type:r.mimeType||'video/webm'});if(blob.size>4_000_000){$('cameraHint').textContent='Clip is too large. Keep it shorter.';return;}try{const data=await blobToDataUrl(blob);storeCameraResult({kind:'video',data});}catch(e){toast(safeError(e));}};
    r.start(500);$('cameraRecord').disabled=true;$('cameraStop').disabled=false;$('cameraHint').textContent='RECORDING · press STOP, maximum 8 seconds.';state.recordTimer=setTimeout(stopClip,8000);
  }catch(e){toast(`Recording is unavailable: ${safeError(e)}`);}
}
function stopClip(){clearTimeout(state.recordTimer);if(state.cameraRecorder?.state==='recording')state.cameraRecorder.stop();$('cameraStop').disabled=true;$('cameraRecord').disabled=false;}
async function startTalk(){if(state.talkHeld)return;state.talkHeld=true;const b=$('radioButton');b.classList.add('talking');b.textContent='RECORDING';
  try{state.talkStream=await navigator.mediaDevices.getUserMedia({audio:true});if(!state.talkHeld){state.talkStream.getTracks().forEach(t=>t.stop());state.talkStream=null;return;}
    const type=supportedRecorderType(false),r=new MediaRecorder(state.talkStream,type?{mimeType:type}:undefined),chunks=[];state.talkRecorder=r;
    r.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};r.onstop=async()=>{try{const blob=new Blob(chunks,{type:r.mimeType||'audio/webm'});if(blob.size>3_500_000)throw new Error('Voice note is too large.');const data=await blobToDataUrl(blob);await action('chat',{room:state.room,text:'Voice note',media:{kind:'audio',data}});toast('Voice note sent.');}catch(e){toast(safeError(e));}finally{state.talkStream?.getTracks().forEach(t=>t.stop());state.talkStream=null;}};
    r.start(300);setTimeout(()=>{if(state.talkHeld)stopTalk();},7500);
  }catch(e){state.talkHeld=false;b.classList.remove('talking');b.textContent='HOLD TALK';toast(`Microphone unavailable: ${safeError(e)}`);}
}
function stopTalk(){if(!state.talkHeld)return;state.talkHeld=false;$('radioButton').classList.remove('talking');$('radioButton').textContent='HOLD TALK';if(state.talkRecorder?.state==='recording')state.talkRecorder.stop();else if(state.talkStream){state.talkStream.getTracks().forEach(t=>t.stop());state.talkStream=null;}}
// A 1:1 WebRTC connection; camera and mic never auto-answer.
async function acquireCallMedia(kind){if(!navigator.mediaDevices?.getUserMedia)throw new Error('Microphone/camera requires HTTPS and browser permission.');return navigator.mediaDevices.getUserMedia({audio:true,video:kind==='video'?{facingMode:'user'}:false});}
function showCallWindow(){const e=$('callWindow');e.hidden=false;e.classList.remove('mini');e.style.left='';e.style.top='';e.style.right='';$('restoreCall').hidden=true;$('audioCallLabel').hidden=state.call?.kind==='video';$('localVideo').hidden=state.call?.kind!=='video';}
async function inviteCall(kind){if(!selectedPeer())return toast('Open a private conversation first.');if(state.call)return toast('Finish your current call first.');
  try{state.localStream=await acquireCallMedia(kind);const r=await action('call:invite',{to:state.peerId,kind});state.call={id:r.callId,kind,peerId:state.peerId,caller:true};$('callLabel').textContent=`${kind.toUpperCase()} / ${selectedPeer()?.name||'UNIT'}`;$('callState').textContent='RINGING...';$('localVideo').srcObject=state.localStream;showCallWindow();}
  catch(e){state.localStream?.getTracks().forEach(t=>t.stop());state.localStream=null;toast(safeError(e));}
}
function onCallIncoming(data){if(state.call){action('call:decline',{callId:data.callId}).catch(()=>{});return;}state.incoming=data;$('incomingInfo').textContent=`${data.fromName} is requesting a ${data.kind.toUpperCase()} call.`;$('incomingOverlay').hidden=false;}
async function answerCall(){const c=state.incoming;if(!c)return;
  try{const stream=await acquireCallMedia(c.kind);state.localStream=stream;state.call={id:c.callId,kind:c.kind,peerId:c.from,caller:false};$('incomingOverlay').hidden=true;state.incoming=null;$('callLabel').textContent=`${c.kind.toUpperCase()} / ${c.fromName}`;$('callState').textContent='CONNECTING...';$('localVideo').srcObject=stream;showCallWindow();await action('call:accept',{callId:c.callId});}
  catch(e){toast(safeError(e));if(state.call?.id===c.callId)cleanupCall();action('call:decline',{callId:c.callId}).catch(()=>{});$('incomingOverlay').hidden=true;state.incoming=null;}
}
async function declineCall(){if(state.incoming)await action('call:decline',{callId:state.incoming.callId}).catch(()=>{});state.incoming=null;$('incomingOverlay').hidden=true;}
async function onCallActive(data){if(!state.call||data.callId!==state.call.id)return;try{await initPeer();if(state.call.caller){const offer=await state.pc.createOffer();await state.pc.setLocalDescription(offer);await action('call:signal',{callId:state.call.id,signal:{description:state.pc.localDescription}});}}catch(e){toast(`Call setup failed: ${safeError(e)}`);}}
async function initPeer(){if(state.pc)return;if(!window.RTCPeerConnection)throw new Error('WebRTC is unsupported in this browser.');
  const pc=new RTCPeerConnection({iceServers:[{urls:'stun:stun.l.google.com:19302'}]});state.pc=pc;
  state.localStream?.getTracks().forEach(track=>pc.addTrack(track,state.localStream));
  pc.ontrack=ev=>{const stream=ev.streams[0]||new MediaStream([ev.track]);$('remoteVideo').srcObject=stream;$('remoteVideo').play().catch(()=>{});};
  pc.onicecandidate=ev=>{if(ev.candidate&&state.call)action('call:signal',{callId:state.call.id,signal:{candidate:ev.candidate.toJSON()}}).catch(()=>{});};
  pc.onconnectionstatechange=()=>{$('callState').textContent=pc.connectionState.toUpperCase();if(pc.connectionState==='failed')toast('Connection failed. Some networks require a relay server.');};
}
async function onCallSignal(data){if(!state.call||data.callId!==state.call.id)return;
  try{if(!state.pc)await initPeer();const pc=state.pc;const sig=data.signal;
    if(sig.description){await pc.setRemoteDescription(new RTCSessionDescription(sig.description));for(const c of state.remoteCandidates.splice(0))await pc.addIceCandidate(new RTCIceCandidate(c));if(sig.description.type==='offer'){const answer=await pc.createAnswer();await pc.setLocalDescription(answer);await action('call:signal',{callId:state.call.id,signal:{description:pc.localDescription}});}}
    if(sig.candidate){if(pc.remoteDescription)await pc.addIceCandidate(new RTCIceCandidate(sig.candidate));else state.remoteCandidates.push(sig.candidate);}
  }catch(e){toast(`Connection negotiation: ${safeError(e)}`);}
}
async function endCall(){const id=state.call?.id;cleanupCall();if(id)try{await action('call:end',{callId:id});}catch(_e){}}
function cleanupCall(hide=true){state.pc?.close();state.pc=null;state.localStream?.getTracks().forEach(t=>t.stop());state.localStream=null;state.remoteCandidates=[];state.call=null;$('remoteVideo').srcObject=null;$('localVideo').srcObject=null;if(hide)$('callWindow').hidden=true;$('incomingOverlay').hidden=true;state.incoming=null;}
function miniCall(){if(!state.call)return;$('callWindow').classList.add('mini');$('restoreCall').hidden=false;}
function fullCall(){if(!state.call)return;$('callWindow').classList.remove('mini');$('callWindow').style.top='';$('callWindow').style.left='';$('callWindow').style.right='';$('restoreCall').hidden=true;}
function setDraggable(){const head=$('callDrag'),pane=$('callWindow');let pointer=null;
  head.addEventListener('pointerdown',ev=>{if(!pane.classList.contains('mini')||ev.target.closest('button'))return;const rect=pane.getBoundingClientRect();pointer={id:ev.pointerId,dx:ev.clientX-rect.left,dy:ev.clientY-rect.top};head.setPointerCapture(ev.pointerId);ev.preventDefault();});
  head.addEventListener('pointermove',ev=>{if(!pointer||pointer.id!==ev.pointerId)return;pane.style.left=`${clamp(ev.clientX-pointer.dx,0,innerWidth-pane.offsetWidth)}px`;pane.style.top=`${clamp(ev.clientY-pointer.dy,0,innerHeight-pane.offsetHeight)}px`;pane.style.right='auto';});
  const clear=()=>{pointer=null;};head.addEventListener('pointerup',clear);head.addEventListener('pointercancel',clear);pane.addEventListener('dblclick',()=>{if(pane.classList.contains('mini'))fullCall();});
}
function bind(){
  $('joinButton').addEventListener('click',join);$('joinName').addEventListener('keydown',ev=>{if(ev.key==='Enter')join();});$('leaveButton').addEventListener('click',()=>{if(confirm('Leave this demo session? Your map items will disappear.'))leave();});
  $('publicRoomButton').addEventListener('click',()=>changeRoom(null));$('statusSelect').addEventListener('change',()=>action('status',{status:$('statusSelect').value}).catch(e=>toast(safeError(e))));
  $('sendButton').addEventListener('click',sendChat);$('chatInput').addEventListener('keydown',ev=>{if(ev.key==='Enter'&&!ev.shiftKey){ev.preventDefault();sendChat();}});
  $('attachChatButton').addEventListener('click',()=>$('chatFileInput').click());$('chatFileInput').addEventListener('change',ev=>onFileChosen(ev,'chat'));
  $('chatCameraButton').addEventListener('click',()=>openCamera('chat'));$('reportFileButton').addEventListener('click',()=>$('reportFileInput').click());$('reportFileInput').addEventListener('change',ev=>onFileChosen(ev,'report'));
  $('reportCameraButton').addEventListener('click',()=>openCamera('report'));
  const radio=$('radioButton');radio.addEventListener('pointerdown',ev=>{ev.preventDefault();radio.setPointerCapture(ev.pointerId);startTalk();});for(const type of ['pointerup','pointercancel','lostpointercapture'])radio.addEventListener(type,stopTalk);
  $all('.mobile-tab').forEach(b=>b.addEventListener('click',()=>setView(b.dataset.tab)));
  $all('.maptool[data-mode]').forEach(b=>b.addEventListener('click',()=>setMode(b.dataset.mode)));$('finishPath').addEventListener('click',finishPath);$('cancelPath').addEventListener('click',()=>setMode('inspect'));
  $('gridButton').addEventListener('click',()=>{state.grid=!state.grid;$('mapGrid').classList.toggle('off',!state.grid);$('gridButton').classList.toggle('active',state.grid);});
  $('mapBoard').addEventListener('click',onMapClick);$('mapBoard').addEventListener('pointermove',ev=>{const p=stageCoords(ev);$('coordReadout').textContent=`X ${p.x.toFixed(1)} / Y ${p.y.toFixed(1)}`;});
  for(const id of ['formClose','formCancel'])$(id).addEventListener('click',()=>$('formOverlay').hidden=true);$('formSave').addEventListener('click',saveForm);
  for(const id of ['detailClose','detailDone'])$(id).addEventListener('click',()=>$('detailOverlay').hidden=true);$('detailRemove').addEventListener('click',removeDetail);$('detailStatus').addEventListener('change',updateDetailStatus);
  $all('.filter-tab').forEach(b=>b.addEventListener('click',()=>{state.reportFilter=b.dataset.reportFilter;$all('.filter-tab').forEach(c=>c.classList.toggle('active',b===c));renderReports();}));
  $('themeButton').addEventListener('click',()=>$('appearanceOverlay').hidden=false);$('appearanceClose').addEventListener('click',()=>$('appearanceOverlay').hidden=true);
  $('themeSelect').addEventListener('change',applyTheme);for(const f of ['brightness','contrast','saturation','hue'])$(`${f}Slider`).addEventListener('input',applyTheme);
  $('resetAppearance').addEventListener('click',()=>{localStorage.removeItem('ase-dispatch-display');themeInit();});
  $('cameraClose').addEventListener('click',closeCamera);$('cameraFlip').addEventListener('click',()=>{state.facing=state.facing==='environment'?'user':'environment';startCamera();});
  $('cameraSnap').addEventListener('click',snapshot);$('cameraRecord').addEventListener('click',startClip);$('cameraStop').addEventListener('click',stopClip);
  $('callAudioButton').addEventListener('click',()=>inviteCall('audio'));$('callVideoButton').addEventListener('click',()=>inviteCall('video'));
  $('answerCall').addEventListener('click',answerCall);$('declineCall').addEventListener('click',declineCall);$('endCall').addEventListener('click',endCall);$('minimizeCall').addEventListener('click',miniCall);$('restoreCall').addEventListener('click',fullCall);
  $('muteButton').addEventListener('click',()=>{const tracks=state.localStream?.getAudioTracks()||[];if(!tracks.length)return;tracks.forEach(t=>t.enabled=!t.enabled);$('muteButton').textContent=tracks[0].enabled?'MUTE':'UNMUTE';});
  setDraggable();
  for(const id of ['formOverlay','detailOverlay','appearanceOverlay'])$(id).addEventListener('click',ev=>{if(ev.target===ev.currentTarget)ev.currentTarget.hidden=true;});
  document.addEventListener('keydown',ev=>{if(ev.key==='Escape'){for(const id of ['formOverlay','detailOverlay','appearanceOverlay'])$(id).hidden=true;}});
}
themeInit();bind();updateClock();setInterval(updateClock,1000);setView('chat');
