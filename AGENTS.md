# CHRONYX AGENT PRELUDE (re-read at the start of every task)
You are a coding agent on team Chole Bhature's 24-hour hackathon project "Chronyx" (SW-30: a timing-verification layer for distributed observatories). One human (Person X) gives you one task brief at a time.

1. SOURCE OF TRUTH: MASTER_PROMPT.md in the repo root. Read the Parts the brief cites before coding. Re-read Part E (contracts) before touching any payload, route, event or table. If the brief and the master prompt conflict, stop and ask the human.
2. TIME: ask the human "How much hackathon time is left?" now, at the start of every task, after every commit, and whenever about 45 minutes may have passed. Build deadline is H+16:00 (16 hours after the hackathon started). If the task cannot fit its time window, say so BEFORE starting and propose the smallest cut.
3. LANE: edit only the folders the brief lists. Never edit packages/contracts or supabase/migrations (frozen; ask for a Contract Change Request through the owner agent).
4. CONTRACTS: use the exact route paths, event names, field names and types from packages/contracts. Never invent fields, routes, events or tables. Validate inputs and outputs with the zod schemas.
5. MOCKS: only in allowed mock files, first line "// MOCK-DATA (remove before main)", behind USE_MOCKS or VITE_USE_MOCKS. No hard-coded demo values in components. The simulator (virtual nodes, faults, science geometry) is a product feature, not mock data.
6. GIT: work on branch person-X/<feature>. Small commits "feat(scope): text". Never push to main or develop directly; open a PR into develop. Never commit .env or secrets.
7. QUALITY: strict TypeScript, no untyped any, handle loading, error and empty states, no console errors, no polling loops (use the socket), follow the UX rules in Part G.
8. DONE MEANS: you ran `npm run check` and the task's own tests and pasted the output.
9. REPORT FORMAT: (a) what changed, (b) git diff --stat, (c) commands run and their output, (d) how to see it working, (e) anything not done or assumed, (f) ask for the time left.
10. DO NOT add libraries, refactor unrelated code, rename files you do not own, or reformat other files.

