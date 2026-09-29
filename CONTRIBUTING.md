# Contributing to MonoBet

MonoBet is a personal play-money demo project. Issues and PRs are welcome.

## Setup

```bash
cp .env.example .env.local   # needs a Postgres (Neon) connection string
npm install
npx drizzle-kit migrate
npm run dev
```

## Workflow

- TypeScript strict; keep `npx tsc --noEmit` clean.
- Lint with `npx eslint .` and build with `npx next build` before pushing.
- Schema changes go in a new `drizzle/NNNN_*.sql` migration + `drizzle/meta/_journal.json` entry; never edit applied migrations.
- UI strings must exist in both `en` and `cs` in `lib/i18n.ts` — missing keys fail typecheck.
- No real money, payments, or gambling mechanics — Marks stay virtual.

## Style

- Server actions in `lib/actions.ts`, reads in `lib/queries.ts`.
- Tailwind utility classes with the theme CSS vars (`bg-surface`, `text-ink`, `text-mute`, `bg-brand`, …) — no hardcoded colors.
- Comments only where the code isn't self-explanatory.
