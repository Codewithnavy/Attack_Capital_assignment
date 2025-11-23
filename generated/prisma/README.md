This directory replaces the former `src/generated/prisma` client to avoid bundling generated Prisma runtime into the Next.js app.

If you need to regenerate the Prisma client, run `npx prisma generate` and place the output under `generated/prisma` (or update `prisma.schema` and generator output).

Note: The original generated client was removed from `src/` to reduce ESLint and bundler noise. If you rely on the generated client in Node-only services, import it from `generated/prisma` instead.
