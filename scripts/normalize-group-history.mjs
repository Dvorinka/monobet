// One-shot data fix: group options used to record independent-binary prices
// in price_point, so charted history doesn't sum to 100%. Under the shared
// book every timestamp's sibling frontier should softmax — which for stored
// probabilities is just p_i / Σ p_j (softmax of logits normalizes).
//
// For each fully-live group we replay the raw points forward, keeping every
// option's latest price as its frontier, and at each distinct timestamp emit
// a normalized point for EVERY option — the same fan-out the new book writes
// per trade. The group's stored history is replaced wholesale, so every line
// is step-complete and each timestamp's siblings sum to exactly 100%.
//
// Groups with any resolved/cancelled option are skipped — their frozen
// history shouldn't be renormalized against a dead sibling's last price.
//
// Idempotent: a second run normalizes already-normalized frontiers (÷ ~1).
//
// Run:  node scripts/normalize-group-history.mjs          (writes)
//       node scripts/normalize-group-history.mjs --dry    (report only)

import { readFileSync } from "node:fs";
import pg from "pg";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i), l.slice(i + 1).replace(/^["']|["']$/g, "")];
    })
);
const url = env.DATABASE_URL_UNPOOLED || env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL(_UNPOOLED) missing");

const dry = process.argv.includes("--dry");
const db = new pg.Client({ connectionString: url });
await db.connect();

// Group parents whose options are ALL still live — safe to rewrite.
const { rows: parents } = await db.query(`
  SELECT parent_id FROM market
  WHERE kind = 'option'
  GROUP BY parent_id
  HAVING count(*) = count(*) FILTER (WHERE status = 'live')
`);

const plans = []; // { ids, insertRows }
for (const { parent_id } of parents) {
  const { rows: opts } = await db.query(
    `SELECT id, label FROM market WHERE parent_id = $1 ORDER BY sort_index, created_at`,
    [parent_id]
  );
  const ids = opts.map((o) => o.id);
  const { rows: pts } = await db.query(
    `SELECT id, market_id, yes_price::float8 AS p, created_at FROM price_point
     WHERE market_id = ANY($1) ORDER BY created_at, market_id`,
    [ids]
  );
  if (!pts.length) continue;

  const idx = new Map(ids.map((id, i) => [id, i]));
  const frontier = new Array(ids.length).fill(undefined);
  const byT = new Map();
  for (const r of pts) {
    const k = r.created_at.getTime();
    (byT.get(k) ?? byT.set(k, []).get(k)).push(r);
  }

  const insertRows = []; // [market_id, p, created_at]
  for (const [t, rows] of byT) {
    for (const r of rows) frontier[idx.get(r.market_id)] = r.p;
    const sum = frontier.reduce((a, p) => a + (p ?? 0), 0);
    if (sum <= 0) continue;
    for (const [i, id] of ids.entries()) {
      if (frontier[i] === undefined) continue;
      insertRows.push([id, frontier[i] / sum, new Date(t)]);
    }
  }
  plans.push({ ids, insertRows, label: opts.map((o) => o.label).join(", ") });
}

const totalIn = plans.reduce((a, p) => a + p.insertRows.length, 0);
for (const p of plans) console.log(`group "${p.label.slice(0, 60)}": ${p.insertRows.length} points for ${p.ids.length} options`);
console.log(`${totalIn} replacement points across ${plans.length} groups`);

if (!dry) {
  await db.query("BEGIN");
  try {
    for (const p of plans) {
      await db.query(`DELETE FROM price_point WHERE market_id = ANY($1)`, [p.ids]);
      await db.query(
        `INSERT INTO price_point (market_id, yes_price, created_at)
         SELECT * FROM unnest($1::uuid[], $2::numeric[], $3::timestamptz[])`,
        [p.insertRows.map((r) => r[0]), p.insertRows.map((r) => r[1]), p.insertRows.map((r) => r[2])]
      );
    }
    await db.query("COMMIT");
    console.log("done");
  } catch (e) {
    await db.query("ROLLBACK");
    throw e;
  }
}
await db.end();
