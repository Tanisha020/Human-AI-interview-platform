# Human + AI Interview Platform — Phase Roadmap

This roadmap continues the existing repository; it is not a rewrite. Core changes are committed directly to `main`. A phase is not considered fully verified until local runtime testing passes.

## Core application

| Phase | Scope | Status |
|---|---|---|
| 1 | Project setup and base UI | Implemented; verify in final regression |
| 2 | PostgreSQL + Prisma data model | Implemented; verify database connection |
| 3 | Authentication and role-based dashboards | Implemented; socket ticket authorization added |
| 4 | Interview creation, assignment, dashboards | Implemented |
| 5 | Live interview room UI | Implemented; responsive/UX review pending |
| 6 | WebRTC + Socket.IO synchronization | Implemented; signaling restricted to shared authenticated rooms |
| 7 | Ollama AI interviewer | Implemented; local Ollama runtime still required |
| 8 | Speech recognition and transcript | Implemented; browser permission/device tests pending |
| 9 | Interview state machine | Implemented; reset and action transitions corrected |
| 10 | Conversation memory | Implemented; reset removes active question from short-term memory |
| 11 | AI provider and question generation | Implemented; technical-first flow and response timeout |
| 12 | Coherent conversational interviewer | Implemented; introduction then technical questions, limited follow-ups |
| 13 | Speech-to-text | Implemented; Edge/Chrome runtime verification pending |
| 14 | AI text-to-speech | Implemented; interviewer controls AI voice |
| 15 | Human controls | Implemented; control-action mapping fixed, reset blank behavior fixed |
| 16 | Real-time synchronization | Implemented; server state remains authoritative |
| 17 | Ordered persistent transcript | Implemented; live interim text is not persisted |

## Evaluation, reports, administration

| Phase | Scope | Status |
|---|---|---|
| 18 | Persist AI answer evaluations with dimension scores | Implemented; database/runtime verification pending |
| 19 | Human interviewer evaluation | Implemented in completed-room UI and authenticated API |
| 20 | Final interview report | Implemented: aggregate report persistence, authorized API, room viewer |
| 21 | Admin monitoring | Implemented dynamic counts and recent interview table; account-editing tools remain future work |
| 22 | Security and privacy | In progress: signed expiring room tickets, DB-backed room membership, authorized controls/chat/signaling, authorized report/evaluation APIs; rate limits and broader privacy controls remain |
| 23 | Failure recovery | In progress: bounded Ollama timeout, async stale-result guards, environment bootstrap, database/Ollama health endpoint; reconnect retry/backoff and stale-room cleanup remain |
| 24 | End-to-end tests | In progress: state-machine regression tests and GitHub Actions for tests/typecheck/lint; real two-browser/device regression remains |
| 25 | Final UX, documentation, deployment | In progress: configurable app/socket URLs, environment example, Windows setup README, admin dashboard and final-report viewer; production deployment guide and full UI polish remain |

## Regression checklist

- Reset Question immediately leaves the active-question panel blank on both participants.
- Next Question after reset uses the same question slot instead of skipping the number.
- Introduction answer advances to technical questioning.
- AI voice can be enabled only by the interviewer and does not block text-based interviewing.
- Candidate and interviewer speech appear with the correct speaker labels.
- Human takeover stops AI speech; Return to AI generates the next question.
- End Interview persists completion and creates/refreshes a report.
- Human evaluation saves and refreshes the report.
- Unauthorized or expired Socket.IO room tickets are rejected.
- Microphone, camera, screen share, transcript, report viewer, and Leave actions are checked in two browser windows.

## Environment notes

- `NEXT_PUBLIC_SOCKET_URL` optionally overrides the Socket.IO server URL (defaults to `http://localhost:3001`).
- `NEXT_PUBLIC_APP_URL` optionally overrides the allowed browser origin (defaults to `http://localhost:3000`).
- The Next.js app and Socket.IO server must share `SOCKET_AUTH_SECRET`, `AUTH_SECRET`, or `NEXTAUTH_SECRET` for signed room tickets.
- Local AI question generation requires Ollama at `OLLAMA_BASE_URL` (default `http://localhost:11434`) and the configured model (default `qwen2.5:3b`).
