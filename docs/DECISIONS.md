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

## D-002: V1 Contract Version Compatibility (`1.0.x`)
- Async simulation and crypto change belongs to Persons 1 and 2.
- V1 accepts `1.0.x`.
- `CONTRACT_VERSION` is now `1.0.1`.
- No route, event, or table changes.

