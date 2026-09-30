import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { username } from "better-auth/plugins";
import { nextCookies } from "better-auth/next-js";
import { db, schema } from "@/lib/db";
import { eq, sql } from "drizzle-orm";
import { createAuthMiddleware, APIError } from "better-auth/api";

// Site owner — always admin on auth, regardless of the stored role.
export const SUPER_ADMIN_EMAIL = (process.env.SUPER_ADMIN_EMAIL ?? "info@tdvorak.dev").toLowerCase();

export const auth = betterAuth({
  appName: "MonoBet",
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user: schema.user,
      session: schema.session,
      account: schema.account,
      verification: schema.verification,
    },
  }),
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false,
  },
  user: {
    additionalFields: {
      role: { type: "string", defaultValue: "user", input: false },
      balanceCents: { type: "number", defaultValue: 100_000, input: false },
      lastClaimAt: { type: "date", required: false, input: false },
      bannedAt: { type: "date", required: false, input: false },
      commentsBanned: { type: "boolean", required: false, input: false },
      commentBanUntil: { type: "date", required: false, input: false },
      claimStreak: { type: "number", required: false, input: false },
      lastActiveDay: { type: "string", required: false, input: false },
      activityStreak: { type: "number", required: false, input: false },
      lastSeenAt: { type: "date", required: false, input: false },
      debtCents: { type: "number", required: false, input: false },
      debtRateBps: { type: "number", required: false, input: false },
      debtSince: { type: "date", required: false, input: false },
      wallPrayerAt: { type: "date", required: false, input: false },
      vowBps: { type: "number", required: false, input: false },
    },
  },
  hooks: {
    // Banned accounts cannot sign back in. Username logins post to
    // /sign-in/username, email logins to /sign-in/email — cover both.
    before: createAuthMiddleware(async (ctx) => {
      if (!ctx.path.startsWith("/sign-in")) return;
      const who = ctx.body?.username ?? ctx.body?.email;
      if (typeof who !== "string" || !who) return;
      const [row] = await db
        .select({ bannedAt: schema.user.bannedAt })
        .from(schema.user)
        .where(sql`lower(${schema.user.username}) = lower(${who}) or lower(${schema.user.email}) = lower(${who})`)
        .limit(1);
      if (row?.bannedAt) throw new APIError("FORBIDDEN", { message: "Account suspended" });
    }),
  },
  plugins: [username(), nextCookies()],
  databaseHooks: {
    user: {
      create: {
        // First registered user becomes admin; every signup gets a ledger entry
        // so the cash-flow history is complete from day one.
        after: async (u) => {
          const isOwner = (u.email ?? "").toLowerCase() === SUPER_ADMIN_EMAIL;
          const all = isOwner ? [] : await db.select({ id: schema.user.id }).from(schema.user);
          if (isOwner || all.length === 1) {
            await db.update(schema.user).set({ role: "admin" }).where(eq(schema.user.id, u.id));
          }
          await db.insert(schema.ledger).values({
            userId: u.id,
            amountCents: 100_000,
            balanceAfterCents: 100_000,
            kind: "signup",
            memo: "Welcome bonus",
          });
        },
      },
    },
  },
});

export type Session = typeof auth.$Infer.Session;
