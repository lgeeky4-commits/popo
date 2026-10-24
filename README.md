# ASE Police Dispatch — four-person training demo

This is a **fictional, browser-based dispatch-style coordination project**. It is not an official police application and must not be used for real emergencies, evidence management, sensitive records, or safety-critical communication. Names are NOT verified; media and chat are stored in server memory; a restarted server loses the session data. Camera and microphone access require consent.

## Start it on a computer (no extra packages)

1. Install Node.js version 18 or newer, if it is not already installed.
2. Extract this ZIP and open a terminal / Command Prompt inside the extracted `ase-police-dispatch` folder.
3. Run `npm start` (or `node server.js`).
4. Open `http://localhost:3000` on the **same device**.

This new project has **zero external npm dependencies**. Keeping the server running is necessary until it is deployed online.

## Make a phone-friendly public website (GitHub + Render)

1. Create a new GitHub repository.
2. Upload **the contents** of the extracted folder. `server.js`, `package.json`, and `README.md` must be at the repository root, immediately alongside the **public** folder. Do not nest the whole project in an additional folder.
3. Sign in to Render and choose **New -> Web Service**. Connect the GitHub repository.
4. Use these settings:
   - Runtime/language: `Node`
   - Build command: `npm install`
   - Start command: `npm start`
   - Root directory: leave blank, assuming your files are in the repository root.
5. Deploy. Use Render's HTTPS URL on your phone and share it with up to three other people.
6. If the site fails to load, open `<your website address>/health`. You should see `"status":"ok"`.

**Correct file layout:**

```text
server.js
package.json
README.md
public/
  index.html
  style.css
  app.js
  assets/
    original-map.png
```

If you see `Cannot GET /`, `server.js` and `public/index.html` may not be deployed in the required folder layout, or the wrong service type/root directory may have been chosen.

## Using the website

### Join and public chat

Enter a display name (e.g., `Unit 01`), press ENTER SESSION. A maximum of **four total people** may join. The PUBLIC DISPATCH conversation shares messages, map marks, routes, and incident reports with all connected people.

### Private chat and calls

Select another person's name in the **UNIT ROSTER**. Your chat and map change to the private conversation. Choose **VOICE** or **VIDEO** to call that person. The other person must explicitly choose Answer before the call starts. In a call, use MINIMIZE to make a draggable small window, EXPAND to restore, and END to hang up.

**Important:** WebRTC calls may require a TURN relay for some networks; only a public STUN server is configured here. The phone's browser must allow microphone/camera use. Real two-phone calling has not been verified in this environment.

### Marks on the map

Open MAP on mobile, or use the right side of the desktop dashboard. Choose **MARK**, tap your supplied reference image, enter a title/notes, then SAVE TO MAP. Tap an existing pin to inspect it or remove it if you placed it.

### Draw a path

Choose **PATH**. Tap at least two locations; each tap adds a route point. Choose **FINISH**, give the path a name, and it is shared with your selected conversation. Choose CANCEL to discard the unfinished route.

### Incident reports

Choose **REPORT**, tap the reference image, enter a report title, details, and priority (Low, Routine, High, Urgent). You can upload a photo/video file or choose **BROWSER CAMERA**, then take a photo or record a short clip inside the website. Tap SAVE TO MAP. Other participants in that conversation can open the report, view media, and change its status (Open, Responding, Resolved).

Reports in private chats stay private to that two-person conversation. **The supplied map picture is not georeferenced**: markers refer to positions on the image, not real GPS coordinates.

### Radio-style voice note

Hold **HOLD TALK** beside the chat box, speak, and release. The website sends a short recorded voice note after you release. It is **not a continuous live radio broadcast**. Recordings are limited to about 7.5 seconds.

### Change colors

Use DISPLAY to select Navy, Crimson, Graphite, or Night Green. There are brightness, contrast, saturation, and hue sliders. Settings are saved in your browser.

### Leaving a session

Use LEAVE. Your marks, report media, and drawn paths are removed from connected people's maps when you disconnect. Chat messages can remain in the current server's temporary memory until the server restarts.

## Prototype limits — important

- **No verified accounts or role-based permissions.** Anyone with the URL can pick a display name while a slot is available. Do not share sensitive police, personal, or location data.
- **Not end-to-end encrypted.** Server operators can technically access data; a secure production version would need authenticated identities, HTTPS, encryption, and audited authorization.
- **No durable database or evidence integrity guarantees.** Everything is stored in memory and disappears on restart. Do not treat reports as official records.
- **Media size:** Approximately 4 MB per photo/video/audio upload after browser processing; video camera clips stop after 8 seconds. Supported file formats vary by phone browser.
- **Not suitable for actual police dispatch or emergency response.** No location validation, uptime guarantee, chain-of-custody, or official CAD integration.
- **Audio/video calls require a direct peer-to-peer connection**, which can fail on restrictive networks without TURN.

## Future directions for a real deployment

Require verified identities and role-based permissions; store reports in a durable encrypted database; use append-only audit trails, incident IDs, report assignment, permissions and retention rules; add clear consent/ownership on videos; support resilient connection/reconnection; test accessibility; and implement a TURN server for dependable calls. Formal legal, security, privacy, and agency reviews would be necessary before any real-world use.
