# MonoMark

Play-money prediction markets in the style of Polymarket. Bet virtual **Marks (Ɱ)** on custom yes/no events with friends — no real payments, no crypto, just an automated market maker and a leaderboard.

## Features

- **Binary & multi-outcome markets** priced by LMSR (logarithmic market scoring rule) — instant liquidity, prices move with every trade; "X by when?" groups render each option as its own Yes/No line with resolved ones collapsing under "View resolved"
- **Anyone can create a market**: it goes live instantly; the creator picks the starting odds (3–97%) and liquidity depth (Thin/Standard/Deep)
- **User-managed categories**: DB-backed tabs; anyone can mint a new category in the market form, admins rename (markets carry over) and delete empty ones
- **English / Čeština**: full UI i18n with a header language toggle (cookie-persisted), locale-aware dates and number formats
- **Live charts**: animated probability chart with crosshair tooltip, draw-in line animation, live pulse, delta chip, and sparklines on every card — pages auto-refresh so prices stay current
- **Virtual currency**: Ɱ1,000 signup bonus, daily faucet claim, admin grants, full cash-flow ledger per user
- **Buy/Sell shares** at live implied probabilities; positions marked to market
- **Market lifecycle**: create → trading → admin resolves → automatic payouts (winning shares pay Ɱ1.00); admins can cancel with refunds
- **Polymarket-style UI**: card grid with sparklines, category tabs, buy/sell ticket, activity feed, comments, live bets ticker, dark/light themes
- **Portfolio & leaderboard**: positions, trade history, wallet ledger, net-worth ranking
- **Admin panel**: market resolution/cancellation, balance grants, direct market creation, category management
- The **first registered user becomes admin**

## Stack

Next.js 16 (App Router, TS strict) · Tailwind 4 · Drizzle ORM · Neon Postgres · Better Auth (username + password) · Vercel

## Local dev

```bash
cp .env.example .env.local   # fill in DATABASE_URL*, BETTER_AUTH_SECRET
npm install
npx drizzle-kit migrate      # apply schema (uses DATABASE_URL_UNPOOLED)
npm run dev
```

## Env vars

| Var | Purpose |
|---|---|
| `DATABASE_URL` | Neon **pooled** connection (app queries) |
| `DATABASE_URL_UNPOOLED` | Neon **direct** connection (migrations only) |
| `BETTER_AUTH_SECRET` | Session signing secret |
| `BETTER_AUTH_URL` | App base URL (e.g. `https://monomark.vercel.app`) |

## Deploy

Live at **https://monomark-weld.vercel.app** — Neon Postgres + Vercel. `vercel.json` pins the `nextjs` framework preset so the Vercel builder emits serverless functions (without it the project's framework is `Other` and only static files deploy). Set the env vars above in the Vercel project, then `vercel --prod`.

## Notes

- Balances are integer cents; shares are `numeric(24,6)`; every balance change writes a `ledger` row (cash flow is fully auditable).
- Trades run in a single Postgres transaction with `SELECT … FOR UPDATE` row locks on market + user — no overspending, no partial trades.
- LMSR liquidity parameter `b` (100/300/900 presets) controls price impact per market; the creator chooses it.
- Starting odds seed `q_yes = b·ln(p/(1−p))`, so markets can open at any probability, not just 50/50.
- "Live" feel is polling-based (`router.refresh()` every 8–15s, paused while the tab is hidden) — no websocket server needed on serverless.
