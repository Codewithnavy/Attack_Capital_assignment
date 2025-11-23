# Changelog

All notable changes to this project will be documented in this file.

## [0.2.0] - 2025-11-23
### Added
- CI workflow to run socket + worker smoke tests
- Worker end-to-end test and socket HTTP smoke test
- `gemini-proxy` HTTP fallback for transcription and worker HTTP integration
- Export endpoints (TXT/SRT/JSON) and session detail UI export improvements
- Export E2E test

### Fixed
- Resiliency in `transcription-worker` for missing session dirs in mock mode (CI friendly)

### Notes
- Real transcription remains opt-in behind `ENABLE_REAL_TRANSCRIPTION` and upstream keys. Use `GEMINI_TRANSCRIBE_URL`/`GEMINI_API_KEY` or provide an upstream provider via `GEMINI_UPSTREAM_URL`.

