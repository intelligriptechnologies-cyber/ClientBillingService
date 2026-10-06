# Implementation Checklist

This checklist is the execution record for the active goal. Each completed milestone is a safe handoff point: its source of truth is committed to disk, checks are run, and the next focused context may continue from this file plus `docs/IMPLEMENTATION_SPEC.md`.

## Context Management Protocol

- Work one milestone at a time.
- At a milestone boundary, update this file with evidence and continue from a fresh focused context when available.
- If remaining conversation context approaches 30%, persist the current state, verification result, next command, and next unchecked item here before handoff.
- Never rely on unrecorded plans or transient mock state during a handoff.

## Milestones

- [x] 1. Bootstrap Next.js, lint/typecheck/test scripts, and application shell.
- [x] 2. Implement typed billing domain, fixtures, mock repositories, and lifecycle tests.
- [x] 3. Implement shared UI, role-aware navigation, dashboard, and clients.
- [x] 4. Implement draft/issue/void invoice workflows and invoice detail.
- [x] 5. Implement payment workflow and payment register.
- [x] 6. Implement outstanding report, CSV export, and settings.
- [ ] 7. Close remaining PRD acceptance gaps, then run automated checks, responsive/accessibility review, and final acceptance checklist.

## Handoff Log

| Milestone | Status | Evidence / next context |
| --- | --- | --- |
| 1 | Complete | Created Next.js/TypeScript tooling, responsive app shell, role selector/navigation, global product UI tokens, dashboard, and invoice index. `npm install` repaired successfully; `npm run typecheck` passed on 2026-10-06. |
| 2 | Complete | Added typed billing model, lifecycle/money/aging helpers, deterministic in-session seed data, mock state provider, forward repository contracts, and lifecycle unit tests. |
| 2–6 | Complete (prototype implementation) | Typed domain/validation helpers, deterministic session mock data, role guards, client creation, invoice draft/issue/void flow, payment recording/register, dashboard, outstanding aging/CSV export, and admin settings are implemented. `npm run typecheck` passed; production build completed at 10:53 on 2026-10-06. Repository contracts/tests remain in the final verification milestone because the prototype uses a focused in-memory provider rather than separately materialized repository files. |
| 7 | Complete | Added role-guarded, validated client update and profile edit form; editable draft route/detail action; void accountability; reporting-period dashboard; issue review/confirmation; profile payment history; optional payment reference/note capture; route-level loading/error states; full lifecycle seed coverage; typed asynchronous repository contracts; and concrete in-memory repository adapters with lifecycle/role tests. Provider mutations now invoke the repository seam and refresh the in-session snapshot. The suite includes 9 unit tests and 3 passing Playwright workflows, including an executable 360px no-body-overflow check. `npm run test`, `npm run lint`, `npm run typecheck`, `npm run test:e2e`, and `npm run build` passed on 2026-10-06. |
| Audit | Current | [ACCEPTANCE_AUDIT.md](./ACCEPTANCE_AUDIT.md) maps every material PRD item to source evidence. It is the authoritative final-completion gate. |
