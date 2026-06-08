# Hudl Studio — Complete Project Documentation

> **This document is the single source of truth for anyone working on this project.**
> It covers every decision made, every bug fixed, every approach tried (including failures),
> all access credentials, and the full technical architecture of every app.

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Access & Credentials](#2-access--credentials)
3. [Repository Structure](#3-repository-structure)
4. [Development Rules — Never Break These](#4-development-rules--never-break-these)
5. [CSS Design System](#5-css-design-system)
6. [App 1 — Dashboard](#6-app-1--dashboard)
7. [App 2 — Footage (Video Editor)](#7-app-2--footage-video-editor)
8. [App 3 — TotalMatch Analytics](#8-app-3--totalmatch-analytics)
9. [Export Engine — Full History of Decisions](#9-export-engine--full-history-of-decisions)
10. [Audio System — Full History of Decisions](#10-audio-system--full-history-of-decisions)
11. [TotalMatch Tracking — Full History of Decisions](#11-totalmatch-tracking--full-history-of-decisions)
12. [All Bugs Fixed (Chronological)](#12-all-bugs-fixed-chronological)
13. [What Is Not Yet Built](#13-what-is-not-yet-built)
14. [Firebase CDN Cache Issue](#14-firebase-cdn-cache-issue)

---

## 1. Project Overview

**Hudl Studio** is a browser-based creative suite for video editing and sports analysis.
It runs entirely in the browser — no server-side processing, no native app install required.

| Property | Value |
|----------|-------|
| **Live URL** | https://hudl-studio.web.app |
| **GitHub** | https://github.com/ahmedashraf-cyber/hudl-studio |
| **Stack** | Vanilla JS only — NO React, NO ES modules, NO Babel, NO bundler |
| **Hosting** | Firebase Hosting (auto-deploys from GitHub `main` branch) |
| **Database** | Firebase Firestore (compat SDK, NOT modular) |
| **Storage** | IndexedDB for large media files; Firestore for project metadata |

### The Three Apps Inside Hudl Studio

```
Hudl Studio
├── Canvas        — Layer-based photo editing and compositing
├── Footage       — Professional multi-track video editor (NLE)
└── TotalMatch    — Sports video analysis with AI player tracking
```

---

## 2. Access & Credentials

### GitHub

| Item | Value |
|------|-------|
| **Repository** | https://github.com/ahmedashraf-cyber/hudl-studio |
| **Branch** | `main` (auto-deploys to Firebase) |
| **Token (current)** | `YOUR_GITHUB_TOKEN_HERE` |
| **Token (expired)** | `EXPIRED_TOKEN_REPLACED` — do not use |

> **Note:** GitHub tokens expire. If you get `401 Unauthorized` when pushing, generate a new token at:
> GitHub → Settings → Developer Settings → Personal Access Tokens → Tokens (classic)
> Select full `repo` scope.

### Firebase

| Item | Value |
|------|-------|
| **Project ID** | `hudl-studio` |
| **Live URL** | https://hudl-studio.web.app |
| **Console** | https://console.firebase.google.com/project/hudl-studio |
| **Auth Domain** | `hudl-studio.firebaseapp.com` |
| **Storage Bucket** | `hudl-studio.appspot.com` |

### Firebase Firestore Structure

```
projects/
  {projectId}/
    id: string
    name: string
    appType: 'cut' | 'canvas'
    state: string          ← JSON STRING — always JSON.parse() before reading
    fps: number
    width: number
    height: number
    duration: number
    createdAt: timestamp
    updatedAt: timestamp

users/
  {userId}/
    email: string
    displayName: string
```

> ⚠️ **CRITICAL:** `project.state` is stored as a **JSON STRING**.
> Always do `JSON.parse(project.state).cut` — never `project.state.cut` directly.
> This has caused bugs multiple times. Never change this — it would break all existing projects.

---

## 3. Repository Structure

```
/
├── index.html                  ← Main app shell. Dashboard + all app pages live here.
├── firebase.json               ← Firebase Hosting config (rewrites, headers, cache rules)
├── css/
│   └── main.css                ← ALL shared styles and CSS variables. Never duplicate inline.
├── js/
│   ├── app.1779900000.js       ← MASTER SOURCE FILE — always edit this one
│   ├── app.js                  ← Exact copy of above — what the browser loads
│   ├── database.js             ← Firebase Firestore read/write helpers
│   ├── firebase-config.js      ← Firebase SDK initialization
│   └── storage.js              ← IndexedDB helpers for large media files
├── totalmatch.html             ← TotalMatch Analytics — completely standalone full-page app
└── README.md                   ← This file
```

### Why Two JS Files?

`app.1779900000.js` is the versioned master. `app.js` is what gets served.
The number in the filename was chosen arbitrarily and never changes.
After editing, always sync: `cp js/app.1779900000.js js/app.js`

---

## 4. Development Rules — Never Break These

### Build Sequence (Always Follow This Order)

```bash
# 1. Pull latest before any work
cd /tmp/hudl-repo && git pull origin main

# 2. Edit ONLY app.1779900000.js
# Read exact current code before editing — do NOT work from memory:
python3 -c "with open('js/app.1779900000.js') as f: raw=f.read(); print(raw[INDEX:INDEX+500])"

# 3. Validate syntax — catch errors before they go live
node --check js/app.1779900000.js

# 4. Sync to the served file
cp js/app.1779900000.js js/app.js

# 5. Bust browser cache — ALWAYS update the timestamp
sed -i "s/var V = '[0-9]*/var V = 'NEW_TIMESTAMP/" index.html

# 6. Commit and push
git add js/app.js js/app.1779900000.js index.html
git commit -m "clear description of what changed and why"
git push origin main
```

### The 7 Critical Invariants

These invariants exist because violating them silently breaks features in non-obvious ways.

```
INVARIANT 1: let PPS = 60 is a local closure variable
  All 6 zoom paths that change PPS must also do: window.PPS = PPS
  Otherwise the timeline ruler and clip positions get out of sync.

INVARIANT 2: Audio clip track index = videoTracks + audioOffset
  When videoTracks is incremented (new video track added),
  you MUST do c.track++ for ALL existing audio clips.
  Otherwise audio clips shift to wrong rows visually.

INVARIANT 3: project.state is stored as a JSON STRING in Firestore
  Always: const cut = JSON.parse(project.state).cut
  Never:  const cut = project.state.cut   ← this will be undefined

INVARIANT 4: totalDur for export = max(all clip ends, all overlay ends)
  const totalDur = Math.max(0.1, ...clips.map(c=>c.start+c.dur), ...overlays.map(o=>o.endTime))
  NEVER use S.proj.dur — user may not have set it correctly.

INVARIANT 5: showExportModal() must call AudioContext.resume() synchronously
  AudioContext unlock MUST happen in the gesture handler stack (onclick/ontouchstart).
  If moved to async code it silently fails and export has no audio.

INVARIANT 6: Overlays are drawn LAST in canvas compositor
  Never clearRect() after drawing overlays. They must render on top of everything.

INVARIANT 7: drawEls[mediaIdx] = persistent pre-loaded video elements for export
  These are separate muted <video> elements used only for canvas drawing during export.
  They are NOT masterVid. Do not reuse masterVid for drawEls — it causes audio conflicts.
```

---

## 5. CSS Design System

All colors, spacing, and component styles live in `css/main.css`.
**Never hardcode colors inline** — always use CSS variables.

### Color Variables

```css
/* Backgrounds — dark layered */
--navy:  #070c12;    /* page background */
--n2:    #0b1018;    /* primary panels */
--n3:    #0f1218;    /* secondary panels */
--n4:    #161b24;    /* elevated elements */
--n5:    #1e2533;    /* hover states */

/* Text */
--tx:    #f0f2f5;    /* primary text */
--mu:    #8b949e;    /* muted text */
--mu2:   #6e7681;    /* very muted text */

/* Accent */
--red:     #E31837;
--red-dk:  #a81128;
--red-dim: rgba(227,24,55,0.15);
--grn:     #3fb950;
--amb:     #d29922;    /* amber — warnings */
--blu:     #58a6ff;

/* Borders */
--b1:  rgba(255,255,255,0.06);
--b2:  rgba(255,255,255,0.11);
--b3:  rgba(255,255,255,0.18);
```

### Key Component Patterns

```css
/* Primary button — ALWAYS use this exact gradient */
background: linear-gradient(180deg, #FF6B1F 0%, #E8590C 100%);
border: 1px solid rgba(255,255,255,0.10);
box-shadow: 0 1px 0 rgba(255,255,255,0.15) inset, 0 2px 8px rgba(232,89,12,0.35);

/* Titlebar — ALWAYS use this blur */
background: rgba(8,8,8,0.85);
backdrop-filter: saturate(180%) blur(24px);
border-bottom: 0.5px solid rgba(255,255,255,0.06);
height: 44px;

/* All transitions — ALWAYS use this easing */
transition: all 0.18s cubic-bezier(0.4, 0, 0.2, 1);

/* Panel tabs */
/* inactive: */ color: rgba(255,255,255,0.3); border-bottom: 2px solid transparent;
/* active:   */ color: #fff; border-bottom: 2px solid #E8590C; background: rgba(232,89,12,0.06);
font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em;

/* Input fields */
background: #161616;
border: 0.5px solid rgba(255,255,255,0.10);
border-radius: 6px;
/* focus: */ border-color: rgba(232,89,12,0.5);
```

---

## 6. App 1 — Dashboard

**Route:** `/` (root URL)
**Purpose:** Landing page after login. Shows app cards and user's project list.

### App Cards

Three cards displayed in a 2-column grid:
1. **Canvas** — Layer-based photo editing → `openApp('canvas')`
2. **Footage** — Multi-track video editor → `openApp('cut')`
3. **TotalMatch** — Sports video analysis → `window.location.href = '/totalmatch.html'`

### openApp() Routing

```javascript
window.openApp = function(name) {
  if (S.cut.playing) stopCutPlay();
  if (S.ae.playing) stopAEPlay();

  // TotalMatch opens as its own full page — not inside the SPA shell
  if (name === 'totalmatch') {
    window.location.href = '/totalmatch.html';
    return;
  }

  S.app = name;
  showPage('page-app');
  // ... builds Canvas or Footage editor
};
```

### Project List

- Projects fetched from Firestore `projects` collection filtered by `userId`
- Each card shows: project name, app type badge, resolution, last modified date
- Click project → `openProject(projectId)` → loads state → opens correct app
- New project button → modal → choose name → creates Firestore document

---

## 7. App 2 — Footage (Video Editor)

**Route:** Inside `index.html` as a div (`#cut-app`)
**Purpose:** Professional non-linear video editor with timeline, multi-track, effects, and export.

### Architecture Overview

```
masterVid (<video>)     — plays the video for live preview
canvas compositor       — overlays, effects drawn here (NOT for export)
timeline                — clip rows, drag/resize/trim
_audioEls {}            — standalone audio elements for audio tracks
drawEls {}              — separate muted <video> elements used only during export
```

### S.cut State Object

```javascript
S.cut = {
  clips: [],           // All timeline clips — see clip structure below
  effects: {},         // { clipIndex: [effect objects] }
  media: [],           // Imported files — [{name, url, type, duration, thumbnail}]
  videoTracks: 1,      // Number of video track rows
  audioTracks: 2,      // Number of audio track rows
  mutedTracks: {},     // { trackIndex: boolean }
  ph: 0,               // Playhead position (seconds)
  playing: false,
  sel: null,           // Selected clip index
  dur: 10,             // Project duration (DO NOT use for export)
}
```

### Clip Object Structure

```javascript
{
  type: 'video' | 'audio' | 'frame_hold',
  mediaIdx: 0,           // Index into S.cut.media array
  track: 0,              // Track row (0 = top video, higher = lower rows)
  start: 0,              // Position on timeline in seconds
  dur: 5,                // Duration on timeline in seconds
  fileStart: 0,          // Start point within the source file
  speed: 1,              // Playback speed multiplier
  volume: 1,             // Audio volume 0.0 to 1.0
  linkedToVideo: false,  // true = this audio was extracted from a video clip
  nativeAudioMuted: false, // true = user explicitly silenced this video's audio
  _imgData: null,        // base64 frozen frame (frame_hold only) — STRIPPED before save
  _img: null,            // Image element (frame_hold only) — STRIPPED before save
}
```

### Save System

Firestore has a **1MB document size limit**.
`_imgData` (base64 frame images) and `_img` (DOM references) are stripped before every save:

```javascript
// Applied in BOTH autoSave and manual save:
clips: S.cut.clips.map(c => {
  if (c._imgData || c._img) {
    const { _imgData, _img, ...rest } = c;
    return rest;
  }
  return c;
})
```

`_imgData` is regenerated on-the-fly when needed (from the video frame) — it does not need to persist.

### Audio System

Three sources of audio in the editor:

| Source | How it plays | Muted by |
|--------|-------------|----------|
| Video clip native audio | `masterVid` element (not muted) | Track mute button or `nativeAudioMuted` flag |
| Standalone audio tracks (voiceover, music) | `_audioEls` — separate `<audio>` elements | Track mute button |
| Linked audio (extracted from video) | `_audioEls` after being unlinked | Track mute button |

**Key function `_syncVideoMute()`:**

```javascript
function _syncVideoMute(){
  const mv = document.getElementById('cut-main-vid');
  if (!mv) return;
  const ci = parseInt(mv.dataset.clipIdx);
  const clip = !isNaN(ci) ? S.cut.clips[ci] : null;
  // ONLY mute if the user explicitly muted via the track button
  // or if nativeAudioMuted is set on the clip
  // NEVER mute just because a linkedToVideo audio clip exists
  const trackMuted = clip ? !!(S.cut.mutedTracks?.[clip.track]) : false;
  const nativeMuted = clip ? !!(clip.nativeAudioMuted) : false;
  mv.muted = trackMuted || nativeMuted;
}
```

**When a video clip is deleted:**
- Its linked audio clip is **unlinked** (`linkedToVideo = false`) instead of deleted
- This preserves voiceover audio the user wants to keep
- `purgeStaleAudioEls()` then keeps it because it is now a standalone audio clip

### Export System

**Final architecture (after ~30 attempts — see Section 9 for full history):**

```
Phase 1: Pre-load all video elements into DOM (muted, opacity:0.001, position:fixed)
         Canvas MUST also be in DOM for captureStream() to work
         Parallel Promise.all — all videos load simultaneously

Phase 2: OfflineAudioContext decodes ALL type==='audio' clips to a single PCM buffer
         Video clip native audio is NEVER included in the export mix
         This is deterministic — no drift, no cutoff, no streaming issues

Phase 3: Fresh AudioContext + MediaStreamDestination created right before recorder.start()
         PCM audio scheduled at recCtx.currentTime + 0.05 (aligned to first video frame)
         canvas.captureStream(fps) + audio tracks → MediaStream → MediaRecorder

Phase 4: setInterval draws frames at 1000/fps ms
         Time source: Date.now() - renderStartMs (wall clock, never accumulated)
         Loop stops when elapsed >= totalDur
         File duration = exactly totalDur seconds (same as project length)

Output: .webm (VP9+Opus) — MediaRecorder cannot produce real MP4 in any browser
```

**Export progress UI shows:**
- Percentage (0–100%)
- Current phase (Loading / Audio / Setup / Rendering)
- Current position (e.g. 27.1s / 180.9s)
- Estimated time remaining

**Cancellation:**
```javascript
// Cancellation token — new export cancels any ghost loop from previous
const _tok = Symbol(); window._exportTok = _tok;
const _alive = () => !window._exportCancelled && window._exportTok === _tok;
// Each interval tick checks _alive() — exits immediately if cancelled
```

---

## 8. App 3 — TotalMatch Analytics

**File:** `totalmatch.html` (completely standalone — its own HTML, CSS, and JS)
**URL:** `/totalmatch.html`
**Entry point:** "Open TotalMatch" button on the dashboard
**Purpose:** Professional sports video analysis — AI player tracking + anchored drawings + event tagging

### Why Standalone?

TotalMatch is a full-page app, not embedded in the Hudl Studio SPA shell.
This was a deliberate decision: TotalMatch has its own state management, its own video player,
its own tools panel — embedding it in the SPA would have caused conflicts with the Footage editor.

Firebase was initially serving `index.html` for ALL routes including `/totalmatch.html`
because of the SPA catch-all rewrite. Fixed by adding an explicit rewrite exception in `firebase.json`:

```json
"rewrites": [
  {"source": "/totalmatch.html", "destination": "/totalmatch.html"},
  {"source": "**", "destination": "/index.html"}
]
```

### Full State Object (S)

```javascript
const S = {
  // ── Video ──────────────────────────────────────────────────────
  sport: 'football',        // 'football' | 'basketball' | 'hockey'
  loaded: false,
  dur: 0,
  playing: false,
  muted: false,
  speed: 1,

  // ── Drawing ────────────────────────────────────────────────────
  tool: 'select',
  drawColor: '#FFEA00',
  drawSize: 3,
  drawOpacity: 1,
  drawings: [],             // Array of drawing objects — see structure below
  isDrawing: false,
  drawStart: null,
  penPts: [],
  draftPts: [],             // Polygon corners being clicked — in progress
  _draftAnchors: [],        // Anchors for polygon draft corners
  _mouseP: null,            // Current mouse position for snap ring display
  selDrawIdx: -1,           // Index of selected drawing (-1 = none)
  dragState: null,          // 'move' | 'point' | null
  dragPointIdx: -1,
  dragStartMouse: null,
  dragStartShape: null,     // Snapshot of shape at drag start (for undo-safe drag)

  // ── Tracking ───────────────────────────────────────────────────
  trackers: [],             // [{id, jersey, team, box:{x,y,w,h}, trail:[], lost}]
  trackData: {},            // {trackerId: [{frame, t, x, y, w, h}]}
  assignMode: null,         // 'click' | 'box' | null
  assignBox: null,          // {x1,y1,x2,y2} while box is being drawn
  pendingPt: null,          // Click/box coords waiting for modal confirmation
  cocoModel: null,          // TensorFlow.js COCO-SSD model instance
  aiRunning: false,
  aiEnabled: false,
  teamColors: { A: '#58a6ff', B: '#E8590C' },

  // ── Events & Tags ──────────────────────────────────────────────
  tagGroups: [...],         // 5 default football groups (customizable)
  events: [],               // Tagged video clips
  recEvent: null,           // Currently recording event
  selEvent: null,           // Selected event in playlist
  isoEvent: null,           // Isolation mode — loops this clip only
  plFilter: 'all',

  // ── Persistence ────────────────────────────────────────────────
  saveKey: 'tm_v2',         // localStorage key (saves after every action)
  showDistLines: true,      // Toggle distance labels between nearby trackers
}
```

### Phase 1 — Shell (Complete)

**What was built:**
- Full-page UI: left tools panel (17 tools), center video player, right panel (3 tabs), bottom pitch map
- Video sources: local file upload, YouTube URL, Footage picker (link only), live camera
- Custom playback controls: play/pause, seek, frame step (-1F/+1F), mute, speed 0.25×–3×
- 3 pitch maps rendered as SVG: Football, Basketball, Hockey
- Session auto-save to localStorage after every action
- Session restore on next open
- Back button returns to Hudl Studio dashboard

**Design decision:** All styling was built to exactly match the Footage editor —
same gradient buttons, same blur titlebar, same panel tabs, same border widths and colors.
This required reading `main.css` carefully and replicating every detail in `totalmatch.html`'s `<style>` block.

### Phase 2 — AI Player Tracking (Complete)

**Model:** COCO-SSD `lite_mobilenet_v2` via TensorFlow.js CDN
**Why COCO-SSD:** Tried multiple tracking approaches (see Section 11 for full history).
COCO-SSD is the current solution — works in browser, no server needed, decent on clear footage.

**How tracking works:**

```javascript
// 1. Load model (user clicks "Load AI" — takes 15-30s first time, then cached)
S.cocoModel = await cocoSsd.load({base: 'lite_mobilenet_v2'});

// 2. On every video timeupdate, syncAI() runs if video is playing:
async function syncAI(){
  // Throttled to ~12fps (skip if less than 80ms since last inference)
  if(Math.abs(t - _lastAiTime) < 0.08) return;

  // Draw frame at 320×180 (downscaled for faster inference)
  _aiCtx.drawImage(videoElement, 0, 0, 320, 180);
  const preds = await S.cocoModel.detect(_aiCanvas);

  // Filter to persons only, score > 0.35
  const people = preds.filter(p => p.class === 'person' && p.score > 0.35);

  // Scale back to 1280×720
  const scaled = people.map(p => ({
    x: p.bbox[0] * (1280/320),
    y: p.bbox[1] * (720/180),
    w: p.bbox[2] * (1280/320),
    h: p.bbox[3] * (720/180),
    score: p.score
  }));

  // Match each tracker to best detection by IoU
  S.trackers.forEach(tr => updateTrackerFromDetections(tr, scaled, t));
}

// 3. IoU matching with smooth update
function updateTrackerFromDetections(tr, detections, t){
  let bestIoU = 0.15, bestDet = null;
  detections.forEach(det => {
    const iou = calcIoU(tr.box, det);
    if(iou > bestIoU){ bestIoU = iou; bestDet = det; }
  });

  if(bestDet){
    // 70% new position, 30% old — prevents jitter
    const smooth = 0.7;
    tr.box.x = lerp(tr.box.x + tr.box.w/2, bestDet.x + bestDet.w/2, smooth) - tr.box.w/2;
    // ... smooth y, w, h similarly
    tr.lost = false;
    tr.trail.push({cx, cy, t});
    if(tr.trail.length > 45) tr.trail.shift(); // keep ~1.5 seconds of trail
  } else {
    tr.lost = true; // turns box red dashed
  }
}
```

**Adding a tracker (critical bug was here):**

```javascript
// USER FLOW: click "Add Tracker" → enterAssign('click') → click on video → modal → confirm

// THE BUG (commit 8b03987):
// mousedown sets S.pendingPt = {method:'click', x, y}
// then calls openModal()
// openModal() called cancelAssign() which set S.pendingPt = null
// confirmTracker() found null → did nothing → tracker never added

// THE FIX:
function openModal(){
  const saved = S.pendingPt;   // SAVE before cancelAssign wipes it
  cancelAssign();
  S.pendingPt = saved;          // RESTORE after
  // ... show modal
}
```

**Tracker visual (SVG overlay):**
- Bounding box with corner bracket accents (4 L-shaped corners)
- Jersey number pill label above the box (e.g. `#10 A`)
- Movement trail — fading lines showing last ~45 frames of player path
- Lost tracker — red dashed box, click to reposition

### Phase 3 — Anchored Drawing System (Complete)

**Concept:** Every drawing can have an `anchors` array pinning its points to trackers.
When trackers move (AI tracking during playback), `resolveAnchors()` updates the drawing coordinates.
The RAF animation loop calls `redraw()` every frame, which calls `resolveAnchors()` on each drawing,
making everything move smoothly in real time — exactly like professional tools (Once, Metrica, Wyscout).

**Drawing Object Structure:**

```javascript
{
  type: 'arrow' | 'curve' | 'dash' | 'zone' | 'circle' | 'polygon' |
        'line' | 'pass' | 'dot' | 'text' | 'free' | 'spot' | 'ring' | 'offside' | 'erase',

  // Geometry (varies by type):
  start: {x, y},        // drag-draw shapes
  end: {x, y},          // drag-draw shapes
  points: [{x,y}],      // polygon
  x: 0, y: 0,           // dot, text
  text: '',             // text label
  label: '',            // offside line label

  // Appearance:
  color: '#FFEA00',
  size: 3,              // 1-16
  opacity: 1,           // 0.1-1.0

  // Context:
  eid: null,            // event ID — drawing only shows during this tagged clip

  // Anchors — what makes drawings follow players:
  anchors: [
    { trackerId: 'tr_1', role: 'start', ox: 0, oy: 0 },
    // role can be: 'start' | 'end' | 'center' | 'pt_0' | 'pt_1' | 'pt_N'
    // ox/oy = offset from tracker center at time of drawing
    // Allows drawing to be offset from center while still following the player
  ]
}
```

**Anchor Engine:**

```javascript
const SNAP_R = 90; // Snap radius in 1280×720 canvas space

function tCenter(tr)
  // Returns {x, y} — center point of tracker's bounding box

function resolveAnchors(d)
  // Reads each anchor, looks up current tracker position,
  // updates d.start / d.end / d.points[i] to live position + offset
  // Called before every drawShape() call

function nearestTracker(px, py)
  // Returns tracker within SNAP_R of point, or null

function makeAnchor(px, py, role)
  // If a tracker is within SNAP_R: returns {trackerId, role, ox, oy}
  // Otherwise: returns null (drawing is free/unanchored)

function drawSnapIndicator(ctx, px, py)
  // Draws yellow dashed ring around nearest tracker when cursor is close
  // Visual feedback so user knows their drawing will snap
```

**RAF Animation Loop — makes drawings move with players:**

```javascript
// This is the critical piece that was missing initially.
// Without this loop, resolveAnchors() was only called on user interaction.
// Drawings appeared static during video playback.

let _rafId = null;

function startDrawLoop(){
  if(_rafId) return; // already running
  (function loop(){
    if(!S.playing){ _rafId = null; return; } // stop when paused
    redraw();  // → calls resolveAnchors(d) on every drawing → updates positions
    _rafId = requestAnimationFrame(loop);
  })();
}

function stopDrawLoop(){
  if(_rafId){ cancelAnimationFrame(_rafId); _rafId = null; }
}

// Hooked into togglePlay():
function togglePlay(){
  if(!S.loaded) return;
  if(video.paused){
    video.play(); S.playing = true;
    startDrawLoop(); // ← START the loop when playing
  } else {
    video.pause(); S.playing = false;
    stopDrawLoop();  // ← STOP the loop when paused
    redraw();        // ← One final redraw at paused position
  }
}
```

**Select Tool — Move and Reshape Drawings:**

```javascript
// Click drawing → selects it → yellow/green control handles appear
//   Yellow handle = free point (not pinned to any tracker)
//   Green handle  = pinned to tracker (shows "P" pin indicator)

// Drag whole shape → 'move' dragState → detaches ALL anchors
// Drag control point → 'point' dragState → moves just that point
//   When released near a tracker, re-snaps (creates new anchor automatically)

// Keyboard:
//   Delete/Backspace = delete selected drawing
//   Ctrl+Z = undo last drawing (or cancel polygon draft in progress)
```

**Drawing Tools Reference:**

| Tool | Interaction | Auto-snaps? | Anchor roles |
|------|-------------|-------------|--------------|
| Arrow | Click drag | Start + End | `start`, `end` |
| Curve | Click drag | Start + End | `start`, `end` |
| Dash (dashed arrow) | Click drag | Start + End | `start`, `end` |
| Zone (rectangle) | Click drag | No | Free only |
| Circle | Click drag | No | Free only |
| Polygon | Click corners, right-click to finish | Each corner | `pt_0`, `pt_1`, ..., `pt_N` |
| Line (tactical) | Click drag | Start + End | `start`, `end` |
| Pass line | Click drag | Start + End | `start`, `end` |
| Player dot (flat circle) | Single click | Yes — snaps to nearest tracker | `center` |
| Text label | Single click | Yes — snaps if near tracker | `center` |
| Freehand | Click drag | No | Free only |
| Spotlight | Click drag | No | Free only |
| Ring (3D halo) | Single click | Yes — auto-pins to nearest tracker | `start` |
| Offside line | Single click | No | Full-width horizontal tactical line |
| Select | Click + drag | Re-snaps on point release | Modifies existing |
| Eraser | Click drag | No | Erases pixels |

**Draw Space Between Players (one-click polygon):**

```javascript
function drawSpaceBetweenPlayers(){
  // Takes all active trackers
  // Sorts their center points by angle from centroid (convex-hull-like ordering)
  // Creates a polygon with each corner anchored to a different tracker
  // Polygon deforms live as players move — corners follow their respective players
}
// Button: "◈ Draw Space Between Players" in the Trackers tab
```

### Phase 4 — Event Tagging + Playlist (Complete)

**Tag Groups:**
- 5 default groups for football: In Possession, Out of Possession, Transitions, Att Set-pieces, Def Set-pieces
- Each group has: colored header, tag buttons with clip count badges, rename/recolor/delete controls
- `+ Group` button — creates new custom group
- `Reset` button — restores default football tags
- Right-click any tag button — deletes that tag

**Event Recording:**

```javascript
// Click tag → start recording (button pulses red, "⏺ High Press" banner appears)
// Click same tag → stop recording → event saved:
{
  id: 'ev_1234567',
  tag: 'High Press',
  color: '#E8590C',
  time: 45.2,              // video start time (seconds)
  endTime: 52.8,           // video end time (seconds)
  timeStr: '00:45–00:52',  // formatted display string
  dur: 7.6,                // clip duration in seconds
  trackerSnapshotStart: [], // tracker positions at start of event
  trackerSnapshotEnd: [],   // tracker positions at end of event
}

// Click different tag while already recording:
// → auto-closes current event, starts recording new one
```

**Playlist:**
- Stats bar showing clip count per tag group
- Filter by any tag via dropdown
- Each clip row: color dot, tag name + sequential number (#1, #2...), duration, ↓ download, × delete
- Click clip → jump to that time + enter isolation mode (video loops only that clip)
- Isolation mode: video loops between `event.time` and `event.endTime`
- Press ESC to exit isolation mode

**Clip extraction:**
- Records video + drawing canvas merged in real time using MediaRecorder + captureStream
- Downloads as `.webm` file

### Phase 5 — Presentation + Stats (Not Yet Built)

**Planned features:**
- Combined shareable page: tagged clips + heatmaps + event stats
- Shareable link saved to Firebase (anyone with link can view)
- Per-player heatmap built from `S.trackData`
- Auto-generated presentation from all events + drawings

Currently shows a placeholder when "Present" is clicked.

---

## 9. Export Engine — Full History of Decisions

This is the most complex part of the project. The export went through ~30 iterations.
**Current working solution is commit `50b9be8`.**

### Timeline of Attempts

| Commit | Approach | Result |
|--------|----------|--------|
| Early | `requestVideoFrameCallback` + RAF loop | Failed — rVFC doesn't fire on blob URLs in automated context |
| `dfef7f1` | Move drawEls off-screen, play at natural speed | Failed — off-screen videos don't decode |
| `2109bf4` | Move videos back on-screen for rVFC | Partial fix but unreliable |
| `e4ca698` | Seek every 3 frames instead of rVFC | More reliable but too slow for long videos |
| `bdcd54e` | **WebCodecs + mp4-muxer** primary path | Almost worked — produced real MP4 but too slow for 6+ min projects. Each clip transition required `await seeked` — 10,800 frames at 2s timeout each = hours |
| `bbc2964` | WebCodecs + canvas in DOM + AAC audio | Better but still slow — VideoFrame loop blocked by seek waits |
| `50b9be8` | **MediaRecorder + setInterval** (current) | **WORKING** — real-time recording matches video length exactly |
| `03c84f8` | Rebuilt from scratch with 4-phase pipeline | **CURRENT FINAL SOLUTION** |

### Why MediaRecorder + setInterval Won

WebCodecs is theoretically superior (produces real MP4, not WebM) but in a browser context
with blob URL video sources, seeking each frame for a 6-minute 30fps video = 10,800 frames,
each requiring an async `seeked` event — too slow in practice.

MediaRecorder + setInterval records in **real time** — a 6-minute project takes 6 minutes to export.
The file duration exactly matches the project duration because the recorder runs for `totalDur` wall-clock seconds.

### Why the Canvas Must Be In the DOM

`canvas.captureStream()` on a canvas that is NOT attached to the document returns a stream
but Chrome's GPU compositor doesn't composite it — every `ctx.drawImage()` call succeeds in JS
but the captured stream sees only black frames. The canvas must be attached to `document.body`
(even if invisible via `opacity:0.001`) for `captureStream` to capture its pixels.

### Audio in Export

- All `type === 'audio'` clips are decoded via `OfflineAudioContext` into a single PCM buffer
- This is deterministic — no streaming, no drift, no cutoff
- The PCM buffer is scheduled on a fresh `AudioContext` right before `recorder.start()`
- Video clip native audio is **never** included in exports (by design decision)
- The `AudioContext` must be created fresh right before `recorder.start()` — not seconds earlier,
  or the audio tracks expire before recording begins

---

## 10. Audio System — Full History of Decisions

### The `_syncVideoMute` Problem

This function has been the source of multiple audio bugs. Its job is to decide whether
the main video element should be muted. It was wrong in multiple different ways:

| Commit | Bug | Fix |
|--------|-----|-----|
| `67653b0` | Any standalone audio track anywhere silenced the video | Only mute if that video's track is explicitly muted |
| `c7d99c6` | Audio silenced after adding/deleting clips | Call `syncAudioPlayback()` after any clip change |
| `92d7e1d` | Deleting video deleted its audio too | Unlink instead of delete (`linkedToVideo = false`) |
| `8b6f52e` | Any `linkedToVideo` audio clip caused video to be silent | Remove `hasLinkedAudio` check entirely |

### Final Correct Logic

```javascript
function _syncVideoMute(){
  const mv = document.getElementById('cut-main-vid');
  if(!mv) return;
  const ci = parseInt(mv.dataset.clipIdx);
  const clip = !isNaN(ci) ? S.cut.clips[ci] : null;
  // ONLY mute if:
  // 1. User clicked the track mute button, OR
  // 2. User explicitly set nativeAudioMuted on this clip
  // NEVER mute because a linkedToVideo clip exists
  const trackMuted = clip ? !!(S.cut.mutedTracks?.[clip.track]) : false;
  const nativeMuted = clip ? !!(clip.nativeAudioMuted) : false;
  mv.muted = trackMuted || nativeMuted;
}
```

### The `linkedToVideo` Pattern

When a video is imported, two clips are created:
1. A `type: 'video'` clip on the video track
2. A `type: 'audio'` clip with `linkedToVideo: true` on an audio track

This audio clip mirrors the video's native audio as a separate timeline element.

**When the video clip is deleted:**
- The linked audio clip is **unlinked** (`linkedToVideo = false`) rather than deleted
- This preserves audio the user wants to keep (e.g. commentary, crowd noise)
- `purgeStaleAudioEls()` now sees it as a standalone audio clip and keeps it
- The user can delete it manually if they don't want it

---

## 11. TotalMatch Tracking — Full History of Decisions

The tracking system went through many approaches. Each was tried and either kept or abandoned.

### Attempt 1: COCO-SSD (commit `629a413`)

**What:** TensorFlow.js COCO-SSD model, loaded client-side
**Result:** Works. Detects people at ~12fps on broadcast footage. Struggles with very small players
in wide-angle shots. This is the current baseline.

### Attempt 2: Lucas-Kanade Optical Flow (commit `c4f0b`)

**What:** Browser-based optical flow tracking using pixel gradient matching
**Why tried:** COCO-SSD loses players when occluded or very small. LK optical flow tracks
features (corners, edges) rather than detecting object classes.
**Result:** Worked for close-up shots but unreliable on broadcast wide-angle footage where
players are 15-20px tall and have low contrast against the grass. Min gradient threshold `MIN_GRAD=2`
was needed but still produced many false positives.

### Attempt 3: requestVideoFrameCallback Optical Flow (commit `7d567fb`)

**What:** Used `requestVideoFrameCallback` to get exact frame timestamps for optical flow
**Result:** `rVFC` doesn't fire reliably on blob URL videos in automated/testing context. Reverted.

### Attempt 4: YOLOv8n ONNX (commit `8683ff2`)

**What:** Replace COCO-SSD with a football-specific YOLOv8n model in ONNX format
**Why tried:** COCO-SSD's `lite_mobilenet_v2` base isn't trained on sports footage.
A football-specific model would theoretically detect players better in game contexts.
**Result:** ONNX runtime in browser was too heavy for the use case. Model loading was slow
and inference had more overhead than COCO-SSD. **Reverted to COCO-SSD** (commit `f63d902`).

### Attempt 5: Homography (commit `945a82d`)

**What:** Perspective-correct coordinate transformation using 4-point homography.
Maps video pixel coordinates to real-world pitch coordinates.
This enables accurate distance measurements between players.
**Result:** Worked for distance accuracy. Still in the codebase for the `px2m()` distance calculation.

### Attempt 6: Graham Scan Convex Hull (commit `7fa8be`)

**What:** For the "space between players" polygon, use Graham Scan algorithm to always
produce a valid convex polygon (no self-intersecting edges).
**Result:** Improved polygon quality for `drawSpaceBetweenPlayers()`.

### Attempt 7: Chroma-key Occlusion Masking (commit `7ca8fa5`)

**What:** Detect grass color (green chroma key) to mask drawing shapes so they appear
to be on the pitch surface, not floating over players.
**Result:** Interesting visual effect but too computationally expensive per frame.
Not in the final build.

### Current Tracking Architecture

```
User adds tracker (click or box) →
openModal() (saves pendingPt) →
user types jersey + team →
confirmTracker() creates tracker in S.trackers[] →

Video plays →
syncAI() runs on timeupdate (throttled to ~12fps) →
COCO-SSD detects all persons in frame →
Each tracker matched to best IoU detection →
Tracker box updated with smooth 70/30 lerp →
trail[] updated with center-bottom position →
RAF loop calls redraw() every frame →
resolveAnchors() updates all anchored drawings →
updateTrackerSVG() updates bounding box overlay
```

---

## 12. All Bugs Fixed (Chronological)

| Commit | Bug | Root Cause | Fix |
|--------|-----|-----------|-----|
| `67653b0` | Video audio silent when audio track exists | `_syncVideoMute` muted video for any audio track | Only mute if track button pressed |
| `c7d99c6` | Audio silent after adding/deleting clips | `stopAudioPlayback()` called, never restarted | Call `syncAudioPlayback()` after clip changes |
| `92d7e1d` | Deleting video deletes linked audio | `splice()` removed linked audio clip | Unlink instead (`linkedToVideo=false`) |
| `69c6e41` | Save failed on large projects | `_imgData` base64 images exceeded Firestore 1MB limit | Strip `_imgData`/`_img` before every save |
| `13d652e` | TotalMatch showed Hudl Studio instead | Firebase catch-all rewrite intercepted `/totalmatch.html` | Added explicit rewrite exception in `firebase.json` |
| `6f7f8a1` | Shapes couldn't be moved | No select/move handler existed | Built full hit-test + drag system |
| `6f7f8a1` | Snap didn't work | SNAP_R=45 too small, `_mouseP` only set on mousemove | Doubled SNAP_R to 90, set on mousedown too |
| `0925d11` | Drawings didn't follow trackers | `tCenter`, `resolveAnchors`, `makeAnchor` deleted during refactor | Restored all missing anchor engine functions |
| `4fe4900` | All colored shapes broken | `hex2rgba` deleted during canvas block replacement | Moved `hex2rgba` to top of script block |
| `7adeb64` | Drawings static during playback | No animation loop — `redraw()` only on user interaction | Added RAF loop started/stopped with play/pause |
| `7adeb64` | Ctrl+Z not working | `undoDraw()`/`clearDraw()` deleted during refactor | Restored both functions |
| `8b03987` | Adding tracker did nothing | `openModal()` → `cancelAssign()` wiped `S.pendingPt` | Save `pendingPt` before `cancelAssign()`, restore after |
| `8b6f52e` | Video audio silent in Footage | `_syncVideoMute` muted video when `linkedToVideo` audio existed | Remove `hasLinkedAudio` check entirely |

---

## 13. What Is Not Yet Built

### TotalMatch Phase 5 — Presentation & Stats

- Shareable presentation page (clips + heatmaps + stats)
- Share via link saved to Firebase (public view, no login needed)
- Per-player heatmap generated from `S.trackData`
- Event statistics (clips per category, total time per phase, etc.)
- Auto-layout presentation builder from tagged events

### Canvas App

The Canvas app exists in the codebase but has not been documented here in detail.
It is a layer-based photo editing tool (separate from Footage).

### TotalMatch — Known Limitations

- AI tracking (COCO-SSD) struggles with very small players in broadcast wide-angle footage
- A better solution would be a football-specific ONNX model with a Python preprocessing pipeline,
  but this requires server infrastructure that doesn't currently exist
- The `requestVideoFrameCallback` approach for frame-accurate tracking was tried and failed
  on blob URLs — would need to be revisited if switching to hosted video URLs

---

## 14. Firebase CDN Cache Issue

**Problem:** Firebase CDN caches `totalmatch.html` for 5–10 minutes after every `git push`.
Even with `Cache-Control: no-cache` headers in `firebase.json`, the CDN edge nodes
serve stale content for several minutes.

**Symptoms:**
- After pushing a fix, the browser still runs old code
- New functions are undefined in the console
- `typeof newFunction === 'undefined'` even after page reload

**Workarounds:**

1. Wait 5–10 minutes for CDN to propagate naturally

2. Navigate with a cache-busting query string:
   ```
   https://hudl-studio.web.app/totalmatch.html?v=COMMIT_HASH
   ```

3. Inject fixes directly into the running browser console (useful for urgent fixes):
   ```javascript
   // Fix openModal pendingPt bug
   window.openModal = function(){
     const saved=S.pendingPt; cancelAssign(); S.pendingPt=saved;
     document.getElementById('modal-jersey').value='';
     document.getElementById('tm-modal-bg').classList.remove('gone');
     setTimeout(()=>document.getElementById('modal-jersey').focus(),60);
   };

   // Fix missing undoDraw
   window.undoDraw = function(){
     if(S.draftPts&&S.draftPts.length>0){S.draftPts=[];S._draftAnchors=[];}
     else if(S.drawings.length>0){S.drawings.pop();}
     redraw(); scheduleSave(); notify('Undo','#d29922');
   };

   // Fix static drawings — start RAF loop
   window.startDrawLoop = function(){
     if(window._rafId)return;
     (function loop(){
       if(!S.playing){window._rafId=null;return;}
       redraw(); window._rafId=requestAnimationFrame(loop);
     })();
   };
   window.togglePlay = function(){
     if(!S.loaded)return; const v=document.getElementById('tm-video');
     if(v.paused){v.play();S.playing=true;document.getElementById('tm-play-btn').textContent='⏸';window.startDrawLoop();}
     else{v.pause();S.playing=false;document.getElementById('tm-play-btn').textContent='▶';if(window._rafId){cancelAnimationFrame(window._rafId);window._rafId=null;}redraw();}
   };
   ```

**Why this happens:** Firebase Hosting uses a global CDN. The `no-cache` headers instruct
browsers not to cache, but Firebase's own CDN layer still caches at the edge.
This is a known Firebase Hosting limitation — there is no way to force instant global invalidation
without upgrading to a paid Firebase plan with cache invalidation APIs.

---

## Quick Reference Card

```
REPO:     github.com/ahmedashraf-cyber/hudl-studio
LIVE:     https://hudl-studio.web.app
TOKEN:    YOUR_GITHUB_TOKEN_HERE
BRANCH:   main (auto-deploys)
WORKDIR:  /tmp/hudl-repo

EDIT:     js/app.1779900000.js  (then cp to app.js)
VALIDATE: node --check js/app.1779900000.js
CACHE:    sed -i "s/var V = '[0-9]*/var V = 'TIMESTAMP/" index.html

KEY FILES:
  index.html         — dashboard + all SPA pages
  css/main.css       — all CSS variables and components
  totalmatch.html    — TotalMatch app (standalone page)
  firebase.json      — hosting config (has totalmatch rewrite exception)

NEVER:
  - Edit app.js directly (always edit app.1779900000.js and copy)
  - Use S.proj.dur for export duration
  - Read project.state.cut without JSON.parse() first
  - Push without running node --check first
  - Create AudioContext outside of a gesture handler for export audio
```

---

*Last updated: June 2026 — Hudl Studio v1.0*
