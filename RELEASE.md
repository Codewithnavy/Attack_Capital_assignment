Release v0.2.0
===============

This document summarizes the v0.2.0 release and lists publish instructions.

Contents:
- CI: GitHub Actions workflows run socket+worker smoke tests.
- Tests: `npm run test:socket`, `npm run test:worker`, `npm run test:export`.
- Developer UX: session export links and copy-export URL helper.
- Transcription: mock worker + HTTP transcription proxy fallback.

Local release checklist
----------------------
1. Run tests locally:

```powershell
npm ci
npm run test:socket
npm run test:worker
npm run test:export
```

2. Bump version (already set to `0.2.0`), commit any final docs, and create a git annotated tag:

```powershell
git tag -a v0.2.0 -m "Release v0.2.0: prototype improvements"
git push origin v0.2.0
```

3. Optionally create a GitHub release from the tag and paste the `CHANGELOG.md` content in the release notes.

Security & keys
---------------
- Ensure no secrets (API keys) are committed. Use GitHub Actions secrets for CI runtime credentials.

Support
-------
For any issues running tests or the proxy, open an issue in the repo with logs and the steps you ran.
