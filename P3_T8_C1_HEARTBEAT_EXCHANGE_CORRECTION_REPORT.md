# CHRONYX P3-T8-C1 — HEARTBEAT EXCHANGE CORRECTION REPORT

**Role:** Person 3 (P3) — Web Core / Browser NodeAgent  
**Repository:** `C:\bmsit`  
**Branch:** `person-3/web-core`  
**Baseline Commit:** `a584447f0181b59484cd8e2ac645a7f4bdcc9234`  
**Date:** 2026-11-22  
**Correction:** Heartbeat exchange transmission updated from `slice(-4)` to `slice(-8)`  
**Status:** IMPLEMENTATION COMPLETE & 100% GREEN — NON-DESTRUCTIVE BUNDLE PREPARED

---

## 1. Executive Summary & Root Cause

In the initial P3-T8 implementation, `packages/agent/src/nodeAgent.ts` retained a legacy slice limit:
```typescript
exchange: this.recentExchanges.slice(-4),
```
While `ClockEstimator` maintained the latest 8 exchanges, the heartbeat payload forwarded only the latest 4 exchanges to the Gateway.

Per P1's T8-C1 instruction, this was corrected to:
```typescript
exchange: this.recentExchanges.slice(-8),
```
Because `this.recentExchanges = this.clockEstimator.getRawExchanges()` strictly caps capacity at 8, this transmits all available raw exchanges (up to eight), preserving chronological ordering, raw exchange values, and any high-RTT exchanges ($> 200\text{ ms}$) without filtering.

---

## 2. Exact Source Diff

```diff
--- a/packages/agent/src/nodeAgent.ts
+++ b/packages/agent/src/nodeAgent.ts
@@ -533,7 +533,7 @@ export class NodeAgent {
         node_id: this.identity.nodeId as UUID,
         seq: this.seq,
         t_local_ms: this.clockShim.nodeNow(),
         prev_hash: this.prevHash,
-        exchange: this.recentExchanges.slice(-4),
+        exchange: this.recentExchanges.slice(-8),
         osc_residual_ms: this.clockShim.getOscResidualMs(),
         health: null, // browser nodes have no GNSS or camera receiver
       };
```

---

## 3. Deterministic Test Evidence

Implemented in `packages/agent/src/__tests__/nodeAgent.test.ts`:
- **Requirement 1 (Eight available exchanges transmitted):** When 10 exchanges are added to `ClockEstimator`, exactly the latest 8 exchanges are included in `submittedHeartbeat.exchange` (length = 8).
- **Requirement 2 (Fewer than eight exchanges transmitted):** When 5 exchanges exist, exactly 5 are transmitted (length = 5).
- **Requirement 3 (Original order and values preserved):** The first exchange has $t_1 = 3000$, and the last exchange has $t_1 = 10000$, matching the arrival order.
- **Requirement 4 (High-RTT sample retained):** Exchange #3 has $\text{RTT} = 445\text{ ms} > 200\text{ ms}$ ($t_4 = 3450$). It is preserved in the transmitted heartbeat payload.
- **Requirement 5 (Passes HeartbeatBodySchema):** `expect(() => HeartbeatBodySchema.parse(submittedHeartbeat)).not.toThrow()` passes with 0 validation errors.
- **Requirement 6 (No more than eight exchanges):** Confirmed `exchange.length === 8`.

---

## 4. Verification Pipeline Output

- **TypeScript (`npm run check:type`):** Exit code 0 (PASSED).
- **ESLint (`npm run check:lint`):** Exit code 0 (PASSED).
- **Vitest (`npx vitest run --reporter=basic`):** 16/16 test files passed, 166/166 tests passed.
- **Web Build (`npm run build -w @chronyx/web`):** Built in 2.04s. Exit code 0 (PASSED).
- **Mock Hygiene (`npm run check-no-mocks`):** 4 allowed mock files scanned, 0 un-flagged mocks. Exit code 0 (PASSED).
