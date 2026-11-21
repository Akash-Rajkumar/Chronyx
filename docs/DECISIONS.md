# Chronyx Decision Log

## D-001: Monorepo and Workspace Architecture (S0)
- **Status:** ACCEPTED
- **Date:** H+0:10
- **Author:** Person 1 (Platform and Integration Lead)
- **Context:** Establishing the monorepo skeleton for Chronyx 24-hour hackathon build.
- **Decision:**
  - npm workspaces configured with `packages/*` and `apps/*`.
  - Node.js 20 LTS target with strict TypeScript across all workspaces.
  - Frozen contract package `@chronyx/contracts` established at Contract Version 1.0.0.
  - Crypto package `@chronyx/crypto` using `@noble/ed25519` and `@noble/hashes` with async signing/verification.
  - Express 4 + Socket.IO 4 server backend with Pino logging, Zod validation, and route registry.
  - React 18 + Vite + Tailwind frontend shell with stubbed routes matching Part G.
  - Mock layers strictly bounded behind `USE_MOCKS=1` and `VITE_USE_MOCKS=1`, marked with `// MOCK-DATA (remove before main)`.

## D-001 (PATCH 1): Asynchronous Simulator, Explicit SHA-512 Noble Crypto, and Contract 1.0.1
- **Status:** APPROVED / AUDITED
- **Date:** H+6:00
- **Author:** Person 1 (Platform & Integration Lead)
- **Context:** Resolving real simulator signing, browser mobile WebCrypto limitations over non-secure LAN HTTP, and aligning contract versioning across Chronyx.
- **Decision:**
  1. `ISim.addVirtualNode(name): Promise<NodeInfo>` becomes async.
  2. `ISim.step(now_ms): Promise<SimNodeOutput[]>` becomes async.
  3. `faultOffsetMs` remains synchronous.
  4. `IEngine.tick` remains synchronous.
  5. The orchestrator must await `sim.step()`.
  6. `packages/crypto`:
     - `signHash` becomes async (already async in `@chronyx/crypto`).
     - `verifyHash` becomes async (already async in `@chronyx/crypto`).
     - `canonicalJson` remains synchronous.
     - `sha256hex` remains synchronous.
  7. Pass SHA-512 explicitly to `@noble/ed25519` using the installed-version-compatible API from `@noble/hashes`:
     `ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m));`
     `ed.etc.sha512Async = (...m) => Promise.resolve(ed.etc.sha512Sync(...m));`
  8. P1 must verify signing and verification on a phone over `http://<LAN-IP>`.
  9. P2-T5 benchmarks must not sign heartbeats. They must use an unsigned internal simulator step exported from `packages/sim`.
  10. Set `CONTRACT_VERSION` to `1.0.1`.
  11. Verify that V1 accepts `1.0.x`.
- **Preservation:**
  - All existing contract schemas except the explicitly authorized version change.
  - All routes.
  - All Socket.IO events and payload schemas.
  - All database tables and migrations.
  - All other frozen interfaces and ownership boundaries.

