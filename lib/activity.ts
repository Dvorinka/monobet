import { db, schema } from "@/lib/db";
import { eq, sql } from "drizzle-orm";
import {
  ACTIVITY_BASE_CENTS,
  ACTIVITY_PER_DAY_CENTS,
  ACTIVITY_CAP_CENTS,
  SEEN_THROTTLE_MS,
} from "@/lib/rewards";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

export function activityBonusCents(streak: number): number {
  return Math.min(ACTIVITY_BASE_CENTS + (streak - 1) * ACTIVITY_PER_DAY_CENTS, ACTIVITY_CAP_CENTS);
}

// Presence tracking — called from getCurrentUser, so it runs on any
// authenticated hit. The first hit of a UTC day rolls the streak and pays the
// daily bonus; later hits only refresh the throttled last_seen stamp.
// The user row lock serializes concurrent first-hits so a day can't pay twice.
export async function touchActivity(userId: string): Promise<{
  lastActiveDay: string;
  activityStreak: number;
  lastSeenAt: Date;
  creditedCents: number;
}> {
  const today = todayUtc();
  return db.transaction(async (tx: Tx) => {
    const [u] = await tx
      .select()
      .from(schema.user)
      .where(eq(schema.user.id, userId))
      .for("update")
      .limit(1);
    if (!u) throw new Error("User not found");
    const seen = new Date();
    if (u.lastActiveDay === today) {
      // Same day — refresh "last online" at most once per throttle window.
      if (!u.lastSeenAt || seen.getTime() - u.lastSeenAt.getTime() > SEEN_THROTTLE_MS) {
        await tx.update(schema.user).set({ lastSeenAt: seen }).where(eq(schema.user.id, u.id));
      }
      return { lastActiveDay: today, activityStreak: u.activityStreak, lastSeenAt: u.lastSeenAt ?? seen, creditedCents: 0 };
    }
    const yesterday = new Date(seen.getTime() - 86400000).toISOString().slice(0, 10);
    const streak = u.lastActiveDay === yesterday ? u.activityStreak + 1 : 1;
    const bonus = activityBonusCents(streak);
    const [upd] = await tx
      .update(schema.user)
      .set({
        lastActiveDay: today,
        activityStreak: streak,
        lastSeenAt: seen,
        balanceCents: sql`${schema.user.balanceCents} + ${bonus}`,
      })
      .where(eq(schema.user.id, u.id))
      .returning({ balanceCents: schema.user.balanceCents });
    await tx.insert(schema.ledger).values({
      userId,
      amountCents: bonus,
      balanceAfterCents: upd.balanceCents,
      kind: "activity",
      marketId: null,
      memo: `Daily activity · day ${streak} streak`,
    });
    return { lastActiveDay: today, activityStreak: streak, lastSeenAt: seen, creditedCents: bonus };
  });
}
