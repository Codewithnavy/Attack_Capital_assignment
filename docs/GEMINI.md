Gemini (HTTP) transcription
===========================

This project supports a configurable HTTP-based transcription fallback for providers like Google Gemini.

If the SDK is not present or does not expose a suitable speech/transcribe client, you can configure a direct HTTP endpoint for transcription by setting:

- `GEMINI_TRANSCRIBE_URL` - full URL of the transcription endpoint that accepts JSON with base64 audio in `audio.content`.
- `GEMINI_API_KEY` - API key to send as a `Bearer` token.

Expected request shape (JSON):

```json
{
  "audio": { "content": "<BASE64_AUDIO>" },
  "config": { "encoding": "WEBM_OPUS", "languageCode": "en-US" }
}
```

The worker will attempt to parse common response shapes (for example: `transcript`, `results[].alternatives[0].transcript`, `outputText`, `text`, or `candidates[0].content`). If the endpoint returns a different schema, adapt the worker or implement a small proxy that translates the provider's response into one of the recognized shapes.

Examples
--------

```powershell
# Example env (PowerShell)
$env:GEMINI_TRANSCRIBE_URL='https://your-proxy-or-provider/transcribe'
$env:GEMINI_API_KEY='<your_key>'
$env:ENABLE_REAL_TRANSCRIPTION='1'
$env:TRANSCRIPTION_PROVIDER='gemini'
node .\server\run-transcribe.js <SESSION_ID>
```

Notes
-----
- This HTTP fallback is intentionally generic because provider SDKs evolve and expose different client shapes. Using a small proxy (serverless or express) to translate the provider's HTTP response into a consistent shape is a robust approach.
- Do not commit keys. Use environment variables or secrets in CI.
