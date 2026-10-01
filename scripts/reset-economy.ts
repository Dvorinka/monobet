// One-shot ops: reset the daily jackpot and run the economy reset on the
// configured DATABASE_URL. Runs the SAME transaction bodies as the admin
// actions (lib/economy-reset.ts) — not a copy.
//   npx tsx scripts/reset-economy.ts          # dry run — reports, no writes
//   npx tsx scripts/reset-economy.ts --apply  # executes
import { config } from "dotenv";
config({ path: ".env.local" });

const APPLY = process.argv.includes("--apply");

async function main() {
  const { db, schema, pool } = await import("../lib/db");
  const { isNull, sql } = await import("drizzle-orm");
  const { resetEconomyTx, WHALE_CAP_CENTS } = await import("../lib/economy-reset");
  const exemptEmail = (process.env.SUPER_ADMIN_EMAIL ?? "").toLowerCase();

  // Report first — what the reset would touch.
  const whales = await db
    .select({ id: schema.user.id, username: schema.user.username, balanceCents: schema.user.balanceCents, role: schema.user.role, email: schema.user.email })
    .from(schema.user)
    .where(sql`${schema.user.balanceCents} > ${WHALE_CAP_CENTS}`);
  console.log(`users over Ɱ${WHALE_CAP_CENTS / 100}: ${whales.length}`);
  for (const w of whales) console.log(`  @${w.username ?? w.id}  Ɱ${(w.balanceCents / 100).toFixed(2)}  role=${w.role}${w.email?.toLowerCase() === exemptEmail ? " (super)" : ""}`);
  const pos = await db.select().from(schema.position);
  console.log(`open positions: ${pos.length}`);

  if (!APPLY) {
    console.log("\ndry run — pass --apply to execute");
    await pool.end();
    return;
  }

  const result = await db.transaction(async (tx) => {
    // Jackpot reset — same update as resetJackpot(): moving starts_at zeroes
    // the live pool and tickets while the draw cadence carries on.
    const jr = await tx
      .update(schema.jackpotRound)
      .set({ startsAt: new Date(), poolCents: 0, tickets: 0 })
      .where(isNull(schema.jackpotRound.drawnAt))
      .returning({ id: schema.jackpotRound.id });
    const eco = await resetEconomyTx(tx, { exemptEmail });
    return { jackpotRounds: jr.length, ...eco };
  });
  console.log(`\njackpot rounds reset: ${result.jackpotRounds}`);
  console.log(`positions unwound: ${result.unwound}`);
  console.log(`balances clamped: ${result.clamped}`);
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
