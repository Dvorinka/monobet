# MonoMark

Play-money prediction markets in the style of Polymarket. Bet virtual **Marks (Ɱ)** on custom yes/no events with friends — no real payments, no crypto, just an automated market maker and a leaderboard.

## Features

- **Binary markets** priced by LMSR (logarithmic market scoring rule) — instant liquidity, prices move with every trade
- **Virtual currency**: Ɱ1,000 signup bonus, daily faucet claim, admin grants, full cash-flow ledger per user
- **Buy/Sell shares** at live implied probabilities; positions marked to market
- **Market lifecycle**: users propose → admin approves → trading → admin resolves → automatic payouts (winning shares pay Ɱ1.00)
- **Polymarket-style UI**: card grid with sparklines, category tabs, probability chart with range filters, buy/sell ticket, activity feed, comments
- **Portfolio & leaderboard**: positions, trade history, wallet ledger, net-worth ranking
- **Admin panel**: proposal queue, market resolution/cancellation (with refunds), balance grants, direct market creation
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

Neon project + schema are provisioned; deploy with `vercel --prod` and set the env vars above in the Vercel project.

## Notes

- Balances are integer cents; shares are `numeric(24,6)`; every balance change writes a `ledger` row (cash flow is fully auditable).
- Trades run in a single Postgres transaction with `SELECT … FOR UPDATE` row locks on market + user — no overspending, no partial trades.
- LMSR liquidity parameter `b` (default 300) controls price impact per market.
