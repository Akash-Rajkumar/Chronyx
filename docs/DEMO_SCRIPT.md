# Chronyx — 90-Second Live Demo Script (Part H1)

> **Scope note:** This is the 90-second live product demonstration script from Part H1. It is separate from the 6–7 minute first-round pitch deck presentation.
> **Honesty rule:** Read every detection time, timing error, node count, and size-error percentage directly off the running screen at demo time. Never recite pre-typed or memorized numbers.

---

## Pre-Demo Setup (Conditional — Verify Before Stage)

Confirm each item before going on stage (fallbacks below if any item is unavailable):
- [ ] Server and web app reachable (deployed URLs, or local `npm run dev` fallback).
- [ ] Target cluster online: 4 real browser/phone nodes + 3 virtual nodes (or current verified online count), all showing `Trusted` on Overview (`/`).
- [ ] Presenter mode mounted and active (`?present=1` or key `P`). *(Requires Person 3 `AppShell.tsx` integration.)*
- [ ] Shared QR join modal available on key `Q` and tested on venue Wi-Fi or phone hotspot. *(Requires Person 3 QR modal callback.)*
- [ ] Clean baseline state via `POST /api/v1/demo/reset` before starting.

---

## 90-Second Sequence

### 1. `0:00 – 0:10` — Hook (`/` Overview)
- **On screen:** Live Overview showing all online observatory nodes in agreement (green / `Trusted`).
- **Say:** *"Here is our distributed observatory cluster — every node in agreement, all green. Sync tools make clocks agree, but who checks that a clock is actually telling the truth?"*

### 2. `0:10 – 0:20` — The Problem (`/` Overview)
- **Say:** *"In a stellar occultation sweeping Earth at 20 km/s, just 1 millisecond of timing error moves an asteroid chord by 20 metres. Standard sync tools follow whatever time they are given."*

### 3. `0:20 – 0:35` — Same Attack, Two Systems (`/compare` Before vs After)
- **Action:** Navigate to **Before vs After** (`/compare`) and trigger **Slow drag** (button or shortcut `2`).
- **Say:** *"Same software-injected slow drag, same data. Left is a naive sync follower. Right is Chronyx's verification layer."*

### 4. `0:35 – 0:55` — The Moment (`/compare` Before vs After)
- **On screen:** Watch the left baseline error climb with permanent status `No alarm raised`. Watch the right Chronyx panel transition the target node to `Suspect` (amber) and `Quarantined` (red), holding its data and dropping confidence.
- **Say:** *"The naive follower carries the error with no alarm raised. Chronyx detects the drift, quarantines the node, and holds its observations. Look at the live strip: time to detect is **[read live `Time to detect` off screen]** at **[read live `Error at detection` off screen]**."*

### 5. `0:55 – 1:10` — Why It Matters (`/science` Science Impact)
- **Action:** Click **See what this does to the science** (or navigate to `/science`).
- **On screen:** Three SVG panels (`Truth`, `Fault trusted`, `Fault quarantined`) computed live from `POST /api/v1/science/replay`.
- **Say:** *"Same asteroid, same six stations, one bad clock. If you trust the faulty station, the fitted size error is **[read live `Fault trusted` % off screen]**. With Chronyx quarantining that station, the error drops to **[read live `Fault quarantined` % off screen]**."*

### 6. `1:10 – 1:25` — Judge Joins Live (`/` Overview + QR Join)
- **Action (if QR modal & venue network are verified):** Press `Q` to open the QR modal; a judge scans to join at `/join` as a real browser node. Trigger `judge_attack` on their node.
- **Say:** *"Your phone is now a real node in the cluster sending signed heartbeats. We inject a software-only demo attack on your phone — your screen shows `Demo attack in progress`, and the dashboard quarantines it."*
- **Fallback (if QR modal or venue Wi-Fi blocks phone join):** Switch to phone/laptop hotspot, or join from a second team laptop tab and state clearly: *"Using a second browser tab as a real node on this network."*

### 7. `1:25 – 1:35` — Proof & Close (`/scoreboard` Scoreboard)
- **Action:** Navigate to **Scoreboard** (`/scoreboard`).
- **On screen:** Card A (`Measured live in this session`) showing the session's recorded fault table, baseline alarms count, and the `How this is measured` disclosure note.
- **Say:** *"Every number here was measured live in this session against software-injected ground truth, with simulated GNSS/camera streams clearly labelled. Our roadmap adds authenticated GNSS (OSNMA), real receiver inputs, and observatory network pilots — none of which are claimed as built today. Don't trust a timestamp. Verify it."*

---

## Fallbacks (Part H3)
1. **Judge phone / venue Wi-Fi blocked:** Switch join link to a phone or laptop hotspot; if still blocked, join from a team laptop tab and state that honestly.
2. **Deployed server unreachable:** Run locally with `npm run dev` (web served on LAN IP via `--host`) over a laptop hotspot.
3. **Real nodes unreliable:** Demo with the 3 virtual nodes plus 2 real local browser tabs and state: *"Real clocks on two laptop tabs, simulated GNSS and camera streams on three virtual nodes."*
4. **Live environment failure:** Play the recorded backup video of the 90-second script on the final build with voice-over.
