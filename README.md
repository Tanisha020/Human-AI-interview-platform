# Human + AI Interview Platform

A real-time interview application where a human interviewer and an AI interviewer work in the same interview room. The project uses Next.js/React, TypeScript, Socket.IO, WebRTC, Prisma/PostgreSQL, Auth.js, and a local Ollama model.

## Main features

- Role-aware candidate, interviewer, and admin dashboards.
- Interview creation, candidate assignment, scheduling, and a live room.
- WebRTC audio/video and screen sharing.
- AI-led introduction followed by technical interview questions, with limited adaptive follow-ups.
- Interviewer-controlled AI voice; candidates do not control AI voice playback.
- Browser speech recognition with speaker-labelled interim and final transcript segments.
- Human takeover, return-to-AI, next-question, reset-question, and end-interview controls.
- Persisted AI evaluation, human interviewer evaluation, and final report.
- Signed, expiring Socket.IO room tickets and database-backed room authorization.
- Health endpoint for PostgreSQL and Ollama readiness.

## Requirements

- Node.js 20 or newer
- PostgreSQL
- Ollama installed locally (or a compatible reachable Ollama service)
- Microsoft Edge or Google Chrome recommended for browser speech recognition

## Local setup (Windows PowerShell)

Open PowerShell in the repository root.

1. Install packages:

   ```powershell
   npm install
   ```

2. Create your environment file. Copy `.env.example` to `.env.local` and fill in your PostgreSQL credentials and strong secrets. Do not commit `.env.local`.

   ```powershell
   Copy-Item .env.example .env.local
   ```

   Generate a random secret if needed:

   ```powershell
   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
   ```

   Set `AUTH_SECRET` and `SOCKET_AUTH_SECRET` to the same strong value in `.env.local`. The Next.js app and Socket.IO server must share this value.

3. Prepare the database:

   ```powershell
   npx prisma generate
   npx prisma migrate deploy
   ```

   For a new local development database where you are creating migrations, use `npx prisma migrate dev` instead of `migrate deploy`.

4. Start Ollama and download the configured model:

   ```powershell
   ollama pull qwen2.5:3b
   ollama serve
   ```

   If Ollama is already running as a background service, you do not need to start it twice.

5. Start the Next.js app in terminal 1:

   ```powershell
   npm run dev
   ```

6. Start Socket.IO in terminal 2, from the same repository root:

   ```powershell
   npm run socket
   ```

7. Open [http://localhost:3000](http://localhost:3000). Sign in with an interviewer account, create an interview, and open the room from the dashboard.

## Useful commands

```powershell
npm run typecheck
npm run lint
npm run build
npm run dev
npm run socket
npx prisma studio
```

## Environment variables

| Variable | Purpose | Default |
|---|---|---|
| `DATABASE_URL` | PostgreSQL connection | Required |
| `AUTH_SECRET` | Auth.js session signing/encryption | Required for production |
| `SOCKET_AUTH_SECRET` | Signs Socket.IO room tickets; use the same value in both processes | Falls back to `AUTH_SECRET` / `NEXTAUTH_SECRET` |
| `OLLAMA_BASE_URL` | Ollama service URL | `http://localhost:11434` |
| `OLLAMA_MODEL` | Model name | `qwen2.5:3b` |
| `AI_PROVIDER` | AI provider selector | `ollama` |
| `NEXT_PUBLIC_APP_URL` | Allowed browser origin for Socket.IO | `http://localhost:3000` |
| `NEXT_PUBLIC_SOCKET_URL` | Browser-visible Socket.IO URL | `http://localhost:3001` |

The Socket.IO bootstrap loads both `.env.local` and `.env` before loading the AI provider, so environment values are available to the standalone process.

## Interview flow

1. The interviewer starts the session.
2. The AI asks one short introduction question.
3. The candidate answers by voice or text.
4. The AI moves into technical fundamentals, DSA, DBMS, OS, networking, projects, and engineering scenarios.
5. The interviewer can take over, reset the active question to a blank state, or continue to the next question.
6. Ending the interview persists completion and creates a final report.
7. The interviewer can submit a human evaluation; the final report is refreshed with that assessment.

Resetting the active question clears the question panel and short-term context from that question onward. Historical transcript/database records are retained for auditability.

## Health check

Open [http://localhost:3000/api/health](http://localhost:3000/api/health). It reports whether PostgreSQL and Ollama are reachable. A degraded response means one of those dependencies needs attention.

## Validation status

GitHub Actions runs TypeScript and ESLint checks on pushes and pull requests. The application still needs a real local regression using two browser windows to verify microphone permissions, transcript synchronization, WebRTC, Ollama responses, database writes, and final report behavior. Do not treat a successful static check as proof of the full real-time flow.

See [PROJECT_ROADMAP.md](./PROJECT_ROADMAP.md) for phase status and the remaining work.
