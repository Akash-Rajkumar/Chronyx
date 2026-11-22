# CHRONYX — P3-T8 CLOCK CORRECTION & BOUNDED OBSERVATION QUEUE IMPLEMENTATION REPORT

**Role:** Person 3 (P3) — Web Core / Browser NodeAgent  
**Repository:** `C:\bmsit`  
**Branch:** `person-3/web-core`  
**Baseline & Ending HEAD:** `a584447f0181b59484cd8e2ac645a7f4bdcc9234`  
**Date:** 2026-11-22  
**Status:** IMPLEMENTATION COMPLETE — 100% VERIFIED — STOPPED BEFORE COMMIT/PUSH

---

## 1. Repository, Branch, and Baseline

- **Repository Path:** `C:\bmsit`
- **Active Branch:** `person-3/web-core`
- **Starting HEAD SHA:** `a584447f0181b59484cd8e2ac645a7f4bdcc9234`
- **Ending HEAD SHA:** `a584447f0181b59484cd8e2ac645a7f4bdcc9234` (Strict compliance: **0 commits, 0 pushes, 0 merges, 0 rebases**)
- **Working Tree:** All changes remain unstaged in P3-owned files.

---

## 2. Changed-Files Manifest & Ownership Boundary

All modifications are strictly within P3 ownership boundaries:

| File Path | Status | Lines Changed | Purpose |
| :--- | :--- | :--- | :--- |
| `packages/agent/src/clockSync.ts` | **NEW** | +177 | Implements `ClockEstimator` with rolling-window (8 exchanges), RTT filtering ($0 \le \text{RTT} \le 200\text{ ms}$), min-RTT sample selection, and timestamp correction. |
| `packages/agent/src/observationQueue.ts` | **NEW** | +245 | Implements `ObservationQueue` bounded at 32 items, reject-newest overflow, stable client IDs, flush-time correction, at-least-once retry, and explicit discard. |
| `packages/agent/src/index.ts` | **MODIFIED** | +2 | Re-exports `clockSync.js` and `observationQueue.js`. |
| `packages/agent/src/nodeAgent.ts` | **MODIFIED** | +151 / -4 | Wires `ClockEstimator` and `ObservationQueue` into `NodeAgent`. Enforces non-silent disposal (`stop()`) and heartbeat payload isolation. |
| `apps/web/src/state/useJoinStore.ts` | **MODIFIED** | +18 / -1 | Exposes clock calibration state (`clockCalibrated`, `estimatedOffsetMs`, `minRttMs`, `pendingObservationsCount`) and safe forced reset in test harness. |
| `packages/agent/src/__tests__/clockSync.test.ts` | **NEW** | +200 | Deterministic tests covering Requirements 1–12 (positive, negative, zero offset, RTT boundaries, non-finite values, sample thresholds, rolling updates). |
| `packages/agent/src/__tests__/observationQueue.test.ts` | **NEW** | +280 | Deterministic tests covering Requirements 13–25 (capacity 32, reject-newest, disconnect preservation, stable IDs, at-least-once retry, disposal refusal, explicit discard). |
| `packages/agent/src/__tests__/nodeAgent.test.ts` | **MODIFIED** | +124 | Integration tests covering Requirement 26 (heartbeat payload compatibility with raw exchanges), observation deferral, auto-flush, and disposal refusal. |

**Protected Boundaries Confirmed:**
- `packages/contracts/`: 0 files touched (frozen contracts preserved).
- `supabase/migrations/`: 0 files touched.
- `apps/server/`: 0 files touched.
- `packages/engine/` & `packages/sim/`: 0 files touched.

---

## 3. Gateway Idempotency Investigation Findings

A mandatory read-only inspection was performed across the Gateway persistence layer (`supabase/migrations/0001_init.sql`) and mock server routes (`apps/server/src/mocks/mockService.ts`):

1. **Database Schema Inspection (`supabase/migrations/0001_init.sql#L82-L92`):**
   ```sql
   create table observations (
     id uuid primary key default gen_random_uuid(),
     node_id uuid not null references nodes(id),
     kind text not null,
     observed_at_ms double precision not null,
     payload jsonb not null default '{}',
     status text not null check (status in ('accepted','held','released','rejected')),
     confidence double precision not null,
     state_at_ingest text not null,
     created_at timestamptz not null default now()
   );
   ```
2. **Contract Ingestion Schema (`packages/contracts/src/schemas.ts#L228`):**
   ```typescript
   export const ObservationCreateSchema = z.object({
     node_id: z.string().uuid(),
     kind: z.enum(['occultation_timing', 'generic']),
     observed_at_ms: z.number(),
     payload: z.record(z.unknown()),
   });
   ```
3. **Evidence & Verdict:**
   - The Gateway does **not** accept a top-level client observation ID in `ObservationCreate`. It generates its own database `id` via `gen_random_uuid()`.
   - There is **no database unique constraint** on `(node_id, observed_at_ms)` or any client tracking token.
   - If a client retries a submission after a transient network drop (e.g. Gateway received the request and inserted the row, but the HTTP response was lost), the Gateway will unconditionally insert a duplicate observation row.
4. **Conclusion:**
   **Idempotency cannot be established on the Gateway.** Chronyx enforces **at-least-once retry behavior with possible duplicate ingestion on the Gateway**. To facilitate traceability, the client attaches its stable tracking ID under `payload.client_observation_id`.

---

## 4. Clock Estimator Implementation & Formulas

Implemented in [`packages/agent/src/clockSync.ts`](file:///C:/bmsit/packages/agent/src/clockSync.ts):

### Formulas
- **Round-Trip Time:**
  $$\text{RTT} = (t_4 - t_1) - (t_3 - t_2)$$
- **Peer Offset (Node minus Hub):**
  $$\theta = \frac{(t_1 - t_2) + (t_4 - t_3)}{2}$$
- **Gateway-Aligned True Timestamp:**
  $$t_{\text{gateway}} = t_{\text{browser}} - \theta$$

### Validity & RTT Filtering
An exchange sample is accepted into the estimation pool if and only if:
$$0.0 \le \text{RTT} \le 200.0\text{ ms}$$
and all four timestamps $t_1, t_2, t_3, t_4$, the calculated RTT, and calculated offset are finite numbers. Samples with $\text{RTT} > 200\text{ ms}$, $\text{RTT} < 0\text{ ms}$, or non-finite values are rejected with structured error reasons (`RTT_EXCEEDS_THRESHOLD`, `NEGATIVE_RTT`, `NON_FINITE_TIMESTAMPS`).

---

## 5. Offset Correction Evidence

Empirically and mathematically verified in unit tests:
1. **Positive Offset ($\theta = +50\text{ ms}$, Node fast):**
   - $t_1 = 1050, t_2 = 1010, t_3 = 1015, t_4 = 1075 \implies \text{RTT} = 20\text{ ms}, \theta = +50\text{ ms}$.
   - $t_{\text{browser}} = 5000\text{ ms} \implies t_{\text{gateway}} = 5000 - (+50) = 4950\text{ ms}$ (corrected backwards).
2. **Negative Offset ($\theta = -800\text{ ms}$, Node slow):**
   - $t_1 = 1200, t_2 = 2010, t_3 = 2015, t_4 = 1225 \implies \text{RTT} = 20\text{ ms}, \theta = -800\text{ ms}$.
   - $t_{\text{browser}} = 5000\text{ ms} \implies t_{\text{gateway}} = 5000 - (-800) = 5800\text{ ms}$ (corrected forward).
3. **Zero Offset ($\theta = 0\text{ ms}$):**
   - $t_1 = 1000, t_2 = 1010, t_3 = 1015, t_4 = 1025 \implies \theta = 0\text{ ms}$.
   - $t_{\text{browser}} = 7000\text{ ms} \implies t_{\text{gateway}} = 7000\text{ ms}$ (preserved).
4. **Dynamic Offset Guard:**
   - The S2 measured value ($-795.463\text{ ms}$) is **never hardcoded**. All calculations derive dynamically from live rolling-window samples.

---

## 6. Calibration Threshold & Rolling-Window Behavior

1. **Window Size:** Holds up to the latest 8 exchanges in exact chronological order.
2. **Minimum Valid Samples:** Requires at least **3 valid samples** ($\text{RTT} \le 200\text{ ms}$) within the window before transitioning to `isCalibrated: true`.
3. **Min-RTT Selection:** When calibrated, the estimator inspects all valid samples in the window and selects the sample with the minimum RTT:
   $$k^* = \arg\min \text{RTT}_k, \quad \theta_{\text{est}} = \theta_{k^*}$$
4. **Window Invalidation:** When high-jitter samples ($> 200\text{ ms}$) arrive and push older valid samples out of the 8-sample window such that fewer than 3 valid samples remain, the estimator immediately transitions back to `isCalibrated: false`, `estimatedOffsetMs: null`, and refuses timestamp correction.

---

## 7. Heartbeat Payload Compatibility Evidence

Requirement 26 is strictly enforced in [`packages/agent/src/nodeAgent.ts`](file:///C:/bmsit/packages/agent/src/nodeAgent.ts):
- `NodeAgent` stores the raw, unfiltered exchanges in `this.recentExchanges = this.clockEstimator.getRawExchanges()`.
- When constructing `HeartbeatBody`, `exchange: this.recentExchanges.slice(-4)` transmits the full raw exchanges (including those with $\text{RTT} > 200\text{ ms}$) to the Gateway.
- The local estimator filters exchanges **only for clock estimation**, leaving protocol transport 100% compliant with the frozen contract.
- Verified in `nodeAgent.test.ts` (Req 26): Heartbeat packets containing exchanges with $\text{RTT} = 460\text{ ms}$ serialize and validate against `HeartbeatBodySchema` without truncation or alteration.

---

## 8. Observation Queue Capacity & Reject-Newest Behavior

Implemented in [`packages/agent/src/observationQueue.ts`](file:///C:/bmsit/packages/agent/src/observationQueue.ts):
1. **Maximum Capacity:** 32 items.
2. **Reject-Newest Policy:**
   - Observations 1 through 32 are enqueued in FIFO order.
   - When the 33rd observation arrives, `ObservationQueue.enqueue()` immediately throws `QueueOverflowError(32, 32)`.
   - **Zero Data Loss for Pre-existing Items:** All 32 older queued observations remain completely preserved and uncorrupted. No older item is silently overwritten or discarded.
3. **Overflow Recovery:** Once successful flushing dispatches items to the Gateway and creates capacity, new observations are accepted again.

---

## 9. Disconnect/Reconnect Preservation Behavior

- During a temporary Socket.IO disconnect (`socket.on('disconnect')`), `NodeAgent.pauseLoops()` suspends timers, but **the observation queue is untouched**.
- Pending observations remain safely in memory across disconnect, reconnect, and re-join cycles.
- When connection and calibration are restored, `attemptFlushPendingObservations()` automatically resumes draining the queue.

---

## 10. Flush-Time Timestamp Correction

Observations are captured with raw browser time ($t_{\text{capture}}$) at the moment of the event. Timestamp correction is intentionally deferred until flush execution:
$$\text{observed\_at\_ms} = t_{\text{capture}} - \theta_{\text{calibrated\_at\_flush}}$$
This guarantees that observations deferred during initial node startup or temporary network drop are corrected against the most recent, highest-fidelity clock calibration available at the actual transmission boundary.

---

## 11. Retry Semantics & Stable Observation Identity

1. **Client ID Generation:** Every enqueued item is assigned a stable UUID (`crypto.randomUUID()`).
2. **Immutability Across Retries:** If a network failure (e.g. timeout, `ECONNRESET`, HTTP 500) occurs during flush:
   - The item is kept in the queue.
   - Its `retryCount` increments and `lastError` is recorded.
   - The original `id`, `local_timestamp_ms`, and `payload` are preserved without mutation or ID regeneration.
3. **Eviction Criterion:** An item is removed from the queue **only after** `submitFn` resolves successfully with a valid `Observation` confirmation.

---

## 12. Duplicate-Ingestion Limitation

As established in Section 3:
- The Gateway does not support server-side deduplication.
- Chronyx provides **at-least-once delivery**. If a submission succeeds on the server but the network severs the response, the subsequent retry will cause duplicate ingestion on the Gateway.
- The stable `client_observation_id` embedded inside `payload` provides downstream analytics with an audit key to identify and reconcile duplicate entries.

---

## 13. Permanent Disposal & Explicit Discard

1. **Disposal Refusal (`nodeAgent.stop()`):**
   - If `queue.size() === 0`: `stop()` executes clean teardown (cleans listeners, disconnects socket, releases wake lock, resets state).
   - If `queue.size() > 0`: `stop()` throws `PendingObservationsDisposalError`, refusing silent shutdown and reporting the exact pending count and IDs.
2. **Explicit Authorized Discard:**
   - Requires calling `nodeAgent.discardPendingObservations(reason: string)`.
   - Rejects empty strings or whitespace reasons.
   - Returns a structured `DiscardReport`:
     ```typescript
     {
       discardedCount: number;
       discardedIds: string[];
       reason: string;
       discardedAtMs: number;
     }
     ```
   - Clears the queue only upon explicit authorization, permitting subsequent clean disposal.

---

## 14. Deterministic Test Suite Coverage (All 26 Requirements)

| # | Requirement | Test Suite & Test Name | Result |
|---|---|---|---|
| 1 | Positive peer offset | `clockSync.test.ts` > Req 1: computes positive offset accurately and corrects browser timestamp | **PASSED** |
| 2 | Negative peer offset | `clockSync.test.ts` > Req 2: computes negative offset accurately and moves timestamp forward | **PASSED** |
| 3 | Zero peer offset | `clockSync.test.ts` > Req 3: preserves timestamp when peer offset is zero | **PASSED** |
| 4 | RTT exactly 0 ms | `clockSync.test.ts` > Req 4: accepts exchange with RTT exactly 0 ms | **PASSED** |
| 5 | RTT exactly 200 ms | `clockSync.test.ts` > Req 5: accepts exchange with RTT exactly 200.0 ms | **PASSED** |
| 6 | RTT greater than 200 ms | `clockSync.test.ts` > Req 6: rejects exchanges with RTT exceeding 200 ms | **PASSED** |
| 7 | Negative RTT | `clockSync.test.ts` > Req 7: rejects exchange with negative RTT | **PASSED** |
| 8 | Invalid/non-finite values | `clockSync.test.ts` > Req 8: rejects NaN, Infinity, and non-numeric exchange values | **PASSED** |
| 9 | Fewer than 3 valid samples | `clockSync.test.ts` > Req 9: marks estimator uncalibrated when fewer than 3 valid samples exist | **PASSED** |
| 10 | Exactly 3 valid samples | `clockSync.test.ts` > Req 10: transitions to calibrated upon receiving exactly 3 valid samples | **PASSED** |
| 11 | Minimum RTT selection (8 exchanges) | `clockSync.test.ts` > Req 11: selects the sample with minimum RTT among valid exchanges | **PASSED** |
| 12 | Rolling-window & loss of calibration | `clockSync.test.ts` > Req 12: rolling window drops old samples and transitions back to uncalibrated | **PASSED** |
| 13 | Queue capacity of 32 | `observationQueue.test.ts` > Req 13: accepts up to exactly 32 observations in queue | **PASSED** |
| 14 | Reject-newest for 33rd observation | `observationQueue.test.ts` > Req 14, 15, 16: rejects 33rd observation with QueueOverflowError | **PASSED** |
| 15 | Preservation of older queued observations | `observationQueue.test.ts` > Req 14, 15, 16: preserves all 32 older items | **PASSED** |
| 16 | Explicit overflow error reporting | `observationQueue.test.ts` > Req 14, 15, 16: throws QueueOverflowError with code & capacity | **PASSED** |
| 17 | Queue preservation across disconnect | `observationQueue.test.ts` > Req 17: preserves pending observations in memory across disconnects | **PASSED** |
| 18 | Flushing after calibration | `observationQueue.test.ts` > Req 18, 19: flushes deferred observations upon calibration | **PASSED** |
| 19 | Current offset applied at flush time | `observationQueue.test.ts` > Req 18, 19: applies current calibrated offset at flush time | **PASSED** |
| 20 | Stable IDs across retries | `observationQueue.test.ts` > Req 20: preserves exact same client ID across retry attempts | **PASSED** |
| 21 | Duplicate-delivery limitation | `observationQueue.test.ts` > Req 21: documents at-least-once retry behavior with stable ID | **PASSED** |
| 22 | Disposal with empty queue | `observationQueue.test.ts` > Req 22: permits disposal without error when queue is empty | **PASSED** |
| 23 | Disposal with pending observations | `observationQueue.test.ts` > Req 23: refuses disposal & throws PendingObservationsDisposalError | **PASSED** |
| 24 | Explicit discard reporting | `observationQueue.test.ts` > Req 24: requires explicit call with reason & returns audit report | **PASSED** |
| 25 | No silent queue clearing | `observationQueue.test.ts` > Req 25: guarantees queue is never silently cleared | **PASSED** |
| 26 | Heartbeat payload compatibility | `nodeAgent.test.ts` > Req 26: retains invalid-for-estimation exchanges in heartbeat payload | **PASSED** |

---

## 15. Full Verification Pipeline Results

### 15.1 TypeScript Typecheck
```powershell
npm run check:type
# > chronyx-root@1.0.0 check:type
# > tsc --build
# Exit code: 0 (PASSED)
```

### 15.2 ESLint
```powershell
npm run check:lint
# > chronyx-root@1.0.0 check:lint
# > eslint . --ext .ts,.tsx
# Exit code: 0 (PASSED)
```

### 15.3 Vitest Suite (100% Pass Rate)
```powershell
npx vitest run --reporter=basic
# Test Files: 16 passed (16)
# Tests:      166 passed (166)
# Exit code: 0 (PASSED)
```

### 15.4 Web Application Build
```powershell
npm run build -w @chronyx/web
# > @chronyx/web@1.0.0 build
# > tsc && vite build
# ✓ 140 modules transformed.
# dist/assets/index-CmDwJ3Kk.js   419.85 kB │ gzip: 125.61 kB
# ✓ built in 2.23s
# Exit code: 0 (PASSED)
```

### 15.5 Mock Hygiene Check
```powershell
npm run check-no-mocks
# Scan complete. Found 4 files with MOCK-DATA markers.
# Mock hygiene check PASSED.
# Exit code: 0 (PASSED)
```

---

## 16. Known Limitations and Unresolved Risks

1. **In-Memory Queue Volatility:** The observation queue lives purely in browser memory. Browser tab closure, reload, or crash will lose queued un-submitted observations. (Persistence across reloads was explicitly non-contracted and prohibited).
2. **Gateway Duplicate Ingestion:** Because the Gateway lacks idempotency support or deduplication indexes, network dropouts during flush acknowledge phases can result in duplicate observation entries in PostgreSQL.
3. **Severe Network Jitter Lockout:** If network RTT continuously exceeds 200 ms (e.g. sustained packet queueing), the node will remain in the `uncalibrated` state and defer observations up to the 32-item limit, after which incoming observations will be rejected with `QueueOverflowError`.

---

## 17. Final Git Status & Non-Negotiable Stop

```powershell
git status --short
 M apps/web/src/state/useJoinStore.ts
 M packages/agent/src/__tests__/nodeAgent.test.ts
 M packages/agent/src/index.ts
 M packages/agent/src/nodeAgent.ts
?? packages/agent/src/__tests__/clockSync.test.ts
?? packages/agent/src/__tests__/observationQueue.test.ts
?? packages/agent/src/clockSync.ts
?? packages/agent/src/observationQueue.ts
# (plus existing preserved markdown reports)
```

**ABSOLUTE STOP CONFIRMATION:**
- No commit was created.
- No push was executed.
- No branch was switched.
- No files outside P3 ownership were modified.
- All 26 requirements verified and passing.
- Standing by for P1 final review and subsequent commit authorization.
