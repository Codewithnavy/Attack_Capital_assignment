Production Prisma + Postgres migration notes
============================================

This project uses a lightweight JSON dev-store (`tmp/db.json`) for local development. To move to a production-ready Postgres + Prisma setup, follow these steps.

1) Add `DATABASE_URL` to your environment or secret store

Example `.env` (do not commit):

```
DATABASE_URL=postgresql://user:password@localhost:5432/scribeai
```

2) Install Prisma (already a dev dependency)

```bash
npm install prisma --save-dev
npm install @prisma/client --save
```

3) Update `prisma/schema.prisma` if needed, then run:

```bash
npx prisma generate
npx prisma migrate deploy # or migrate dev locally
```

4) Replace JSON DB helpers

- Move the logic currently in `server/*` that reads/writes `tmp/db.json` to use `@prisma/client` instead.
- Inject a `prisma` client instance in server modules and update `create/find/update` helpers to use Prisma models.

5) CI and migrations

- Ensure your CI environment has `DATABASE_URL` set and runs `npx prisma migrate deploy` before starting the app.

6) Optional: keep JSON dev shim

- Keep `tmp/db.json` and the existing helpers for local dev; gate usage with an env var like `USE_JSON_DB=1` so you can run lightweight local tests without a Postgres instance.

Security
--------
- Never commit `.env` with secrets. Use your provider's secret management in production (GitHub Actions secrets, or cloud provider secret store).
