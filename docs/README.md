# Chronyx

**Don't trust a timestamp. Verify it.**

Chronyx is a software-only timing-verification layer for distributed observatories (SW-30, Bits2Wave, Team Chole Bhature). Standard synchronization tools (NTP, PTP, chrony) make clocks agree, but do not verify whether a clock is telling the truth. Chronyx sits on top of synchronization to detect drifting or spoofed clocks, quarantine untrusted nodes, and score observation timing confidence.

---

## Architecture

Nodes (real browser tabs running a Web Worker agent and server-side simulated virtual nodes) perform two-way time exchanges (`time:ping`) with the Express 4 + Socket.IO 4 hub and submit Ed25519-signed, SHA-256 hash-chained heartbeats every second (`@chronyx/crypto`). On each 1 Hz tick, the server verifies heartbeat signatures and chain continuity, computes each node's clock offset relative to the hub, and runs a cluster consensus and anomaly-detection engine (`@chronyx/engine`) that compares every node against peer consensus and independent streams to assign trust states (`trusted`, `suspect`, `quarantined`, `recovering`) and timing-confidence scores. Quarantined nodes have their observations held from science pipelines, while the server persists state and evidence to Supabase Postgres (using the server-only service-role key with Row Level Security enabled) and broadcasts live updates over Socket.IO to the React + Vite + Tailwind + Zustand web interface.

### Security & Deployment Boundaries

- **Heartbeat & Timing Integrity:** Real browser nodes and virtual nodes authenticate over WebSocket / Gateway using Ed25519 signatures and SHA-256 hash chains verified by `HeartbeatService`.
- **Observation REST Boundary:** `POST /api/v1/observations` verifies node registration in `NodeRegistry` and binds incoming observations to the node's current cluster trust state (`trusted`, `suspect`, `quarantined`). In accordance with frozen Part E contracts (`ObservationCreateSchema`), individual REST observation requests do not carry per-request cryptographic signatures. Consequently, this endpoint is intended exclusively for isolated, controlled hackathon demo environments and local LAN setups, and must **never** be exposed directly to the public internet without an upgraded authenticated transport (see `docs/DECISIONS.md` D-003).

--- 

## Setup & Run Instructions

### Prerequisites
- **Node.js 20 LTS** and **npm** (workspaces monorepo)
- A **Supabase** Postgres project (for live database persistence; apply `supabase/migrations/0001_init.sql` before live runs)

### 1. Install Dependencies
```bash
npm ci
```

### 2. Configure Environment Variables
Copy `.env.example` to `.env` (never commit `.env` or secrets to git) and populate the values for your environment:

- **Server variables:**
  - `PORT` (default `3001`)
  - `WEB_ORIGIN` (default `http://localhost:5173`)
  - `SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE_KEY` *(server-only; must never appear in web env or client code)*
  - `SERVER_SIGNING_KEY` (hex Ed25519 seed for passports and virtual nodes)
  - `VIRTUAL_NODES` (default `3`)
  - `NTP_ANCHORS` (comma-separated list, default `samay1.nic.in,samay2.nic.in,time.nplindia.org`)
  - `SIM_SEED` (default `42`)
  - `USE_MOCKS` *(development only; purged before release)*
- **Web variables:**
  - `VITE_API_URL` (default `http://localhost:3001`)
  - `VITE_WS_URL` (default `http://localhost:3001`)
  - `VITE_USE_MOCKS` *(development only; purged before release)*

### 3. Run Locally
```bash
# Start server and web dev servers concurrently
npm run dev

# Build all TypeScript workspaces
npm run build

# Run typecheck, lint, and unit/contract tests
npm run check

# Run the end-to-end verification harness (generates docs/VERIFY_REPORT.md)
npm run verify

# Mock hygiene & release scripts
npm run check-no-mocks
npm run purge-mocks
npm run db:prune
```

---

## Honest Limits & Simulation Disclosure

- **What is real:** Each laptop or phone's browser clock (via a browser tab acting as a node), Wi-Fi network delay, Ed25519-signed heartbeats and hash chains, two-way time exchanges, local-clock vs monotonic-timer checks, and server-side public NTP anchor checks (when outbound UDP 123 is permitted).
- **What is simulated:** Virtual-node GNSS time, camera-trigger timestamps, and receiver health (`C/N0`, `AGC`), stellar occultation geometry, and all injected faults are simulated in software. **No RF or satellite signals are transmitted.**
- **Browser timing resolution:** Browser nodes operate at millisecond-scale resolution and do not provide microsecond accuracy.
- **Public time anchors:** Outbound UDP 123 may be blocked by hosting providers or venue Wi-Fi; when unavailable, anchor checks report unavailable rather than failing silently.
- **Byzantine / majority-attack limit:** Under independent faults, cluster voting tolerates `f` faulty nodes where `n >= 3f + 1`. A coordinated attack on a majority of nodes defeats any voting scheme; independent hub-to-anchor checks mitigate this when public anchors are reachable.
- **Not implemented (roadmap only):** Real GNSS receiver hardware inputs, OSNMA authenticated GNSS, and TEXBAT recordings are roadmap items and are not implemented in this build.
- **Empirical numbers:** This README does not claim fixed detection times or accuracy percentages. All measured metrics must be read from live app output on `/compare`, `/science`, and `/scoreboard`.
