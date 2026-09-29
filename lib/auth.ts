import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { username } from "better-auth/plugins";
import { nextCookies } from "better-auth/next-js";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";

export const auth = betterAuth({
  appName: "MonoMark",
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
    },
  },
  plugins: [username(), nextCookies()],
  databaseHooks: {
    user: {
      create: {
        // First registered user becomes admin; every signup gets a ledger entry
        // so the cash-flow history is complete from day one.
        after: async (u) => {
          const all = await db.select({ id: schema.user.id }).from(schema.user);
          if (all.length === 1) {
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
