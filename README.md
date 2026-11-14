# Laser Palm

**Laser Palm** is a single-player, top-down hand-tracked spinning laser arena built with the **Gemini 4** toolkit (`@google/genai >= 3.2.0`).

Your pilot is a continuously spinning circle rendered with your **live cropped webcam face** inside it. You steer by pointing your **left hand**, stop moving to spin in place by hiding your left hand, and unleash a sweeping `0.34s` laser pulse with your **right hand** (followed by a `3.0s` capacitor lock visualized as a dark shroud directly over your hand). Before dropping into a **2-minute single-player sprint** against three distinct AI bot archetypes, you can use **Gemini 4 Hydrogen** to forge custom straight or curved multi-emitter laser rigs, generate non-square polygon arena layouts, compile custom hand-pose triggers, and paint seamless overhead floor and cover textures with **Nano Banana**.

---

## Why Laser Palm Fits the *Build with Gemini 4* Guide

Designed around the four hackathon evaluation pillars from the **Build with Gemini 4: Hackathon Builder Guide**:

1. **Concrete player experience**: Built for physical, arcade-style browser play—turning any laptop webcam and microphone into a zero-controller spatial arena game with full keyboard/mouse fallback.
2. **Work that genuinely needs Gemini 4 + deterministic verification**: Natural-language weapon ideas, non-square map silhouettes, and hand-pose descriptions are synthesized via `gemini-4-hydrogen` structured schemas and immediately verified by a deterministic 2D polygon/collision/beam solver (`src/game/rules.ts`) so spawns, sightlines, inverse beam ranges, and concave borders are always playable.
3. **People stay in control**: All Gemini SDK calls run strictly on the local Express server (`server.ts`); `GEMINI_API_KEY` never enters browser bundles, and gameplay physics run locally in the browser at 60 FPS.
4. **Runs live with real inputs in under 3 minutes**: Zero login or account walls—forge a gun or polygon level in seconds, enable **Hand Cam** + **Voice AI**, and play a complete `2:00` single-player match (or launch straight into combat via `?autostart=1`).

---

## Gemini 4 Model & Toolkit Architecture

All verified model identifiers are centralized in `MODEL_IDS` inside `server.ts` following the **Build with Gemini 4** specification:

| Job in App | Verified Model ID | Endpoint / Transport | How Laser Palm Uses It |
| :--- | :--- | :--- | :--- |
| **AI Laser Gun Forge** | `gemini-4-hydrogen` | `POST /api/gemini/weapon` | Converts natural-language weapon descriptions into `1–12` angular emitter mounts (`angleDeg`), beam curvatures (`-2.4..+2.4`), hex color, and spin speed using `ThinkingLevel.LOW` + native `responseSchema`. |
| **AI Non-Square Level Generator** | `gemini-4-hydrogen` | `POST /api/gemini/arena` | Generates `6–18` vertex non-square `borderPolygon` silhouettes (stars, crescents, triangles, hourglasses, craters), corner spawns, tactical cover blocks, and arena mutators. |
| **AI Custom Gesture Compiler** | `gemini-4-hydrogen` | `POST /api/gemini/gesture` | Compiles plain-English hand poses (e.g. *"two-finger peace sign"*, *"rock horns"*) into 5-finger extension/curl + pinch rules for the 21-landmark hand tracker. |
| **Post-Match Tactical Report** | `gemini-4-hydrogen` | `POST /api/gemini/report` | Analyzes single-player telemetry (kills, deaths, pulse accuracy, emitter count, gesture usage) into a concise post-round debrief and positioning tip. |
| **Seamless 2D Arena Textures** | `gemini-3.1-flash-lite-image` *(Nano Banana)* | `POST /api/gemini/arena` & `GET /api/textures/:id` | Generates `1:1` orthographic top-down floor tile and obstacle block textures in parallel with level geometry. |
| **Live Voice Co-Pilot** | `gemini-3.8-live` | `WS /ws/live` | Two-way low-latency WebSocket voice stream with native `trigger_laser_action` function declarations (`pulse`, `reverse_spin`, `cycle_gun`). |
| **Arena Announcer Speech** | `gemini-3.8-flash-tts` | `POST /api/gemini/tts` | Studio announcer callouts styled via natural-language `speechMetadata.style` with an in-memory LRU audio cache. |
| **On-Device Hand & Face Vision** | MediaPipe `HandLandmarker` + `FaceDetector` | Local WebAssembly (`public/mediapipe`) | 60 FPS local 2-hand skeleton tracking, 3-second dark cooldown hand shroud, and live circular BlazeFace cutout inside the spinning player circle. |

---

## Prerequisites & 15-Minute Local Setup

### Prerequisites

- **Node.js** `>= 20.0.0` and `npm`
- **Google GenAI SDK**: `@google/genai >= 3.2.0` (`^3.3.0` is pinned in `package.json`)
- **Gemini API Key**: Create one in [Google AI Studio](https://aistudio.google.com/).
  - Free-tier keys support `gemini-4-hydrogen`.
  - A billing-enabled (paid-tier) key is recommended if you enable **Nano Banana** image texture generation (`gemini-3.1-flash-lite-image`). You can also uncheck **Nano Banana Textures** in the *AI Level Gen* tab at any time to generate custom LLM polygon levels using Hydrogen alone.
- **Webcam & Microphone** *(optional)*: Recommended for live hand-gesture steering/shooting, circular face cutout, and Gemini Live voice commands. Full keyboard + mouse controls work automatically without a camera.

### 1. Install Dependencies

Clone the repository and install packages from the project root:

```bash
npm install
```

*(Optional — Coding-Agent Setup from the Gemini 4 Hackathon Guide)*: If you are extending this codebase with an AI coding agent or CLI, install the official Gemini 4 skills so your tools use current SDK idioms:

```bash
npx skills add google-gemini/gemini-skills --skill gemini-api-dev
npx skills add google-gemini/gemini-skills --skill gemini-live-api-dev
```

### 2. Configure Environment Variables

Copy `.env.example` to `.env` and add your `GEMINI_API_KEY`:

```bash
cp .env.example .env
```

Edit `.env`:

```env
GEMINI_API_KEY="your_actual_gemini_api_key_here"
APP_URL="http://localhost:3000"
```

> **Security Note**: `.gitignore` excludes `.env*` (except `.env.example`). Never commit your `GEMINI_API_KEY` or environment secrets to Git.

### 3. Run the Application Locally

Start the full-stack Express + Vite server on port `3000`:

```bash
npm run dev
```

Open **`http://localhost:3000`** in Chromium / Google Chrome.

Useful URL query shortcuts:
- `http://localhost:3000` — Opens the Single-Player Lobby, AI Gun Forge, AI Level Generator, and Hand Gesture Studio.
- `http://localhost:3000/?autostart=1` — Skips the title screen and drops immediately into a live `2:00` single-player match.
- `http://localhost:3000/?tutorial=1` — Launches the interactive 4-step hand & voice training sequence.

### 4. Run Deterministic Unit Tests, Typecheck & Production Build

```bash
# Run pure physics, inverse-range, polygon border, gesture & tutorial unit tests (node:test via tsx)
npm test

# Run TypeScript static verification
npm run lint

# Build frontend assets to dist/ and run in production mode
npm run build
NODE_ENV=production npm start
```

---

## Single-Player Gameplay & Controls

### Core Arena Rules

- **Always Spinning**: Your circular hull rotates continuously (`0.95 rad/s` base speed). Timing your pulse as your emitters sweep across a rival is key.
- **Inverse Laser Distance Law**: Adding more shooting points reduces beam range (`computeLaserRange` in `src/game/rules.ts`):
  - `1` emitter → **`26.0m`** long sniper beam
  - `2` emitters → **`16.9m`** twin lance
  - `3` emitters → **`13.1m`** tri-helix
  - `6` emitters → **`8.6m`** close-quarters starburst
  - `12` emitters → **`5.6m`** point-blank ring
- **Sustained Sweep Pulse (`0.34s`) + `3.0s` Cooldown**: Triggering your shoot gesture fires a single `0.34s` sweeping laser burst, then locks your capacitor for `3.0s`. You must release and re-form your shooting gesture for the next pulse.
- **3 Distinct AI Bot Rivals** (or toggle **Solo Practice** on the lobby bar):
  1. **Viper Lance** — Long-range `1`-beam sniper kiter that maintains `13m–18m` standoff distance.
  2. **Helix Orbiter** — Mid-range `3`-beam curved-laser flanker that orbits at `8m–11m` to hook beams around cover.
  3. **Nova Charger** — Aggressive `6`-beam rusher that closes inside `7m` with a visible + audible `0.36s` windup telegraph ring.

### Webcam Hand, Face & Voice Controls

| Input | Action | Behavior |
| :--- | :--- | :--- |
| **Left Hand — Point Index Finger** | Steer pilot circle | Moves in the 2D direction your index finger points. |
| **Left Hand — Hidden / Relaxed** | Stationary spin | Immediately stops translation so you spin cleanly in place. |
| **Right Hand — Shoot Pose** *(Default: Closed Palm)* | Fire laser pulse | Fires one `0.34s` sweeping pulse; applies a **dark cooldown shroud** over your hand for `3.0s`. Custom poses can be recorded live from webcam or described via AI. |
| **Webcam Face Detection** | Live pilot avatar | Crops your face into the center of your spinning circle in real time. |
| **Voice AI (`gemini-3.8-live`)** | `"pulse"` / `"reverse"` / `"switch"` | Triggers a laser pulse, flips spin direction, or cycles preset laser rigs hands-free. |

### Keyboard & Mouse Fallback

- **`WASD` / Arrow Keys** — Move pilot circle (release keys to spin in place)
- **`Space` / Left Click** — Fire single laser pulse (`3.0s` cooldown)
- **`1` `2` `3` `4`** — Equip preset laser rigs (*Mono Pulse Lance*, *Twin Pincer Arcs*, *Tri-Helix Sweeper*, *Hex Nova Ring*)
- **`Q`** — Flip spin direction (clockwise / counter-clockwise)
- **`P` / `Esc`** — Pause / Resume match

---

## 3-Minute Live Demo Flow (Hackathon Judging)

1. **`0:00 – 0:40` · Forge an AI Gun & Non-Square Polygon Map**:
   - In **AI Gun Forge**, enter `"4 alternating claw lasers curving inward"` and click **Forge with AI** (`gemini-4-hydrogen`). Watch the live spinning showcase circle update its emitters and inverse range ring immediately.
   - Switch to **AI Level Gen** and click **Random AI Map** (or enter `"Crescent moon volcanic crater"`). `gemini-4-hydrogen` builds a non-square polygon border + cover layout while `gemini-3.1-flash-lite-image` paints seamless floor and obstacle textures.
2. **`0:40 – 1:15` · Enable Hand Cam, Face Avatar & Custom Pose**:
   - Click **Hand Cam** (and optionally **Voice AI** in *Hand Gestures* → **Record Live Pose** or **AI Set Pose**). Confirm your live cropped face appears inside the spinning circle.
3. **`1:15 – 2:45` · Enter the Single-Player Arena**:
   - Click **ENTER ARENA (2:00 MATCH)** against *Viper Lance*, *Helix Orbiter*, and *Nova Charger*. Steer with your left index finger, hide your left hand to spin in place behind cover, and fire sweeping curved pulses with your right hand or voice (`"pulse!"`, `"reverse!"`).
4. **`2:45 – 3:00` · Post-Match Tactical Scouting Report**:
   - Review standings, pulse hit rate, and the structured tactical coaching tip generated by `gemini-4-hydrogen`.

---

## Gemini 4 Guide Boundaries & Codebase Hygiene

This repository strictly enforces the **Boundaries & Legacy Cleanup** checklist from Page 11 of the *Build with Gemini 4: Hackathon Builder Guide*:

- **Zero legacy sampling or budget flags**: Never passes `temperature`, `topP`, `topK`, or `thinkingBudget` to Gemini 4 models, and never passes `minimal` thinking level to `gemini-4-hydrogen` (uses `ThinkingLevel.LOW`).
- **Automatic implicit caching only**: Makes zero manual context-caching endpoint calls.
- **Native structured schemas & function tools**: Every `gemini-4-hydrogen` endpoint declares a strict `Type.OBJECT` `responseSchema`, and `gemini-3.8-live` declares a native `FunctionDeclaration` (`trigger_laser_action`) rather than prompting in plain text for raw JSON.
- **Deterministic geometry & physics guardrails**: Pure logic in `src/game/rules.ts`, `src/game/gestures.ts`, and `src/game/tutorial.ts` validates AI-generated polygons, repairs self-intersections, enforces spawn clearances, and tests inverse-range beam math via `node:test`.
- **Zero committed secrets or auth bloat**: `GEMINI_API_KEY` stays strictly server-side via `.env`, with zero login walls between launching the app and playing.

---

## Project Layout

```text
├── server.ts                  # Express + Vite server, MODEL_IDS registry, Gemini 4 REST & Live WS routes
├── src/
│   ├── App.tsx                # Single-player state machine, match timer, and audio/vision wiring
│   ├── audio/sfx.ts           # Procedural Web Audio synth + Gemini 3.8 Flash TTS WAV playback
│   ├── components/
│   │   ├── TitleOverlay.tsx   # Single-player lobby, AI Gun Forge, AI Level Gen & Hand Gesture Studio
│   │   ├── GameHud.tsx        # Top-down arena HUD, cooldown capacitor & webcam hand shroud preview
│   │   ├── TutorialBanner.tsx # Interactive 4-step hand & voice training banner
│   │   └── StatusModal.tsx    # Pause modal, post-match bot standings & Gemini 4 scouting report
│   ├── game/
│   │   ├── arenaRenderer.ts   # 60 FPS 2D top-down canvas renderer, sweeping beams & 3 AI bot policies
│   │   ├── rules.ts           # Pure inverse-range math, curved raycasts, polygon borders & collisions
│   │   ├── gestures.ts        # Pure 21-landmark left-point & custom/recorded right-shoot classifiers
│   │   ├── tutorial.ts        # Pure tutorial progression state machine
│   │   └── *.test.ts          # Deterministic node:test suites (rules, gestures, tutorial)
│   ├── net/liveVoiceClient.ts # Browser 16kHz PCM mic streamer & 24kHz audio player for /ws/live
│   └── vision/handTracker.ts  # On-device MediaPipe HandLandmarker + BlazeFace circular face cutout
└── .env.example               # Environment template (copy to .env locally)
```
