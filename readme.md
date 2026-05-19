# SpankWeb

A browser-based motion sound trigger. Shake or slap your device — it plays a sound.

SpankWeb is the web successor to [taigrr/spank](https://github.com/taigrr/spank), a desktop tool that used a laptop's built-in accelerometer to detect physical impacts and play audio clips. This version runs entirely in the browser using the [DeviceMotion API](https://developer.mozilla.org/en-US/docs/Web/API/DeviceMotionEvent) — no installation, no backend, no account required.

---

## How it works

1. The app loads a static manifest of audio clips sourced from the [taigrr/spank](https://github.com/taigrr/spank) repository.
2. It listens to your device's accelerometer via the `devicemotion` browser event.
3. When the acceleration magnitude exceeds a configurable threshold, it picks and plays a clip.
4. Audio is fetched lazily from GitHub raw content on first play and cached in memory for the session.
5. On desktop (no motion sensor), the **Force Slap** button simulates a hit.

---

## Features

### Motion detection
- Reads `acceleration` from `DeviceMotionEvent`, calculates magnitude (`√(x² + y² + z²)`)
- Configurable threshold slider (0.5 G – 10 G)
- **Auto-calibrate** — samples 2 seconds of ambient motion and sets the threshold automatically
- **Haptic feedback** — device vibrates 80ms on every detected hit (Android/supported devices)
- **Fast Mode** — cuts cooldown from 1 s to 350 ms for rapid-fire sessions

### Audio
- **4 categories**: Halo (9 clips), Lizard (1 clip), Pain (10 clips), Sexy (60 clips)
- **Shuffled deck** — every clip in the active category plays before any repeats; never the same clip twice in a row
- **Escalation mode** — Sexy and Lizard categories progressively advance through clips the more you hit; score decays over 30 s
- **Playback speed** — 0.5× (deeper) to 2.0× (higher pitch)
- **Volume scaling** — louder on harder impacts (on by default)
- **Mute toggle** — instantly silences audio without stopping the sensor

### UI / UX
- **Combo flash** — gold "Combo x N" banner when 3+ hits land within 10 seconds
- **Hit counter** — animated 3-digit display of total impacts in the session
- **Live motion meter** — real-time bar with peak marker
- **Session stats** — peak, average, and total hits
- **Recent hit log** — last 5 hits with timestamps, clip name, and magnitude
- **Config persistence** — threshold, category, speed, volume scaling, fast mode, and mute saved to `localStorage` and restored on next visit

### Platform
- **PWA** — installable to homescreen on Android and iOS; works offline once loaded
- **iOS permission flow** — handles `DeviceMotionEvent.requestPermission()` for Safari on iOS 13+
- **Force Slap button** — always available for desktop or no-sensor environments
- **Dark mode** — locked dark theme with neon magenta accent

---

## Device compatibility

| Platform | Behavior |
|---|---|
| Android (Chrome / Firefox) | Motion fires automatically — no permission needed |
| iOS 13+ (Safari) | Tap the power button once — permission prompt appears |
| Desktop (Chrome / Firefox) | No motion sensor — use Force Slap button |
| Desktop (2-in-1 / with sensor) | Some laptops expose DeviceMotion — works automatically |

---

## Audio source

All clips are served directly from GitHub raw content:

```
https://raw.githubusercontent.com/taigrr/spank/master/audio/{category}/{file}
```

The file manifest is bundled statically in `src/audioManifest.ts` — no API calls are made at startup. Individual audio files are fetched lazily on first play and cached as decoded `AudioBuffer` objects for the session.

---

## Stack

| Layer | Technology |
|---|---|
| Frontend framework | React 18 + Vite |
| Language | TypeScript 5 |
| Styling | Tailwind CSS + shadcn/ui |
| Animations | Framer Motion |
| Motion detection | DeviceMotion API (browser-native) |
| Audio playback | Web Audio API (`AudioContext`, `AudioBufferSourceNode`) |
| Package management | pnpm workspaces |
| PWA | Web App Manifest + Service Worker |
| Config storage | `localStorage` |

---

## Running locally

```bash
# Install dependencies
pnpm install

# Start the frontend dev server
pnpm --filter @workspace/spank-web run dev
```

The app serves on the port set by the `PORT` environment variable (injected automatically in the Replit workflow).

---

## Project structure

```
artifacts/spank-web/
├── src/
│   ├── components/MotionTrigger.tsx  # Main app component
│   ├── audioManifest.ts              # Static clip list + raw GitHub URLs
│   ├── App.tsx                       # Root wrapper
│   ├── main.tsx                      # Entry point + SW registration
│   └── index.css                     # Theme + Tailwind config
├── public/
│   ├── manifest.json                 # PWA manifest
│   ├── sw.js                         # Service worker
│   └── icon-192.svg / icon-512.svg   # App icons
└── index.html                        # HTML shell with PWA meta tags
```

---

## Original project

SpankWeb is a browser port of **[taigrr/spank](https://github.com/taigrr/spank)** — a macOS / Linux desktop app written in Go that uses the device's built-in accelerometer to detect physical impacts and play audio clips.

The original uses platform accelerometer APIs and local audio files. SpankWeb replaces all of that with:
- `DeviceMotion API` instead of native accelerometer bindings
- `Web Audio API` instead of local audio playback
- Raw GitHub URLs instead of bundled audio files
- A browser PWA instead of a native desktop binary

---
*A massive thanks to the original creator of taigrr/spank! Your clever idea and unique use of hardware was the inspiration for SpankWeb. We're big fans of the original project and wanted to bring that same fun concept to the web. Thanks for being the catalyst for this browser-based port!*
