Developer quick commands
======================

Use these PowerShell commands to run the app locally. They assume you ran `npm install`.

Start the Socket server (foreground):

```powershell
npm run start:socket
# or explicit:
# cross-env SOCKET_PORT=4001 node server/socket-server.js
```

Start the Next dev app (foreground):

```powershell
npm run dev
# or explicit:
# cross-env NEXT_DISABLE_ESLINT=1 next dev -p 3001
```

Start both concurrently (combined logs):

```powershell
npm run dev:both
```

Run a one-off transcription (mock or real):

```powershell
# Mock (default):
node .\server\run-transcribe.js <SESSION_ID>

# Real (Gemini/OpenAI) - opt-in; set KEY env var first
$env:ENABLE_REAL_TRANSCRIPTION='1'
$env:TRANSCRIPTION_PROVIDER='gemini'    # or 'openai'
$env:GEMINI_API_KEY='<your_key_here>'  # or OPENAI_API_KEY
node .\server\run-transcribe.js <SESSION_ID>
```

Quick troubleshooting

- If you see `EADDRINUSE`, find and stop the process listening on that port (common ports: `3000`, `3001`, `4001`):

```powershell
netstat -ano | Select-String ":4001"
# then kill process id if needed:
Stop-Process -Id <PID>
```

- If Next shows ESLint errors from generated files, run `npm run dev` which sets `NEXT_DISABLE_ESLINT=1` for local development. For CI or production, move generated Prisma client out of `src/` or run `npx prisma generate` in the build step.

- To re-run an individual transcribe test via the Next API (when Next dev is running):

```powershell
Invoke-RestMethod -Method POST -Uri 'http://localhost:3001/api/dev/transcribe-test' -Body (ConvertTo-Json @{ sessionId = '<SESSION_ID>' }) -ContentType 'application/json'
```
