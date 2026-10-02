import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { accruedDebtCents } from "@/lib/loans";

// Lightweight poll for the header wallet chips — the server only feeds the
// header on navigation, so the client polls this to keep the budget live.
export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user?.id) return Response.json({ balanceCents: 0, debtCents: 0 }, { status: 401 });
  const [u] = await db
    .select({
      balanceCents: schema.user.balanceCents,
      debtCents: schema.user.debtCents,
      debtRateBps: schema.user.debtRateBps,
      debtSince: schema.user.debtSince,
      autoRepay: schema.user.autoRepay,
    })
    .from(schema.user)
    .where(eq(schema.user.id, session.user.id));
  if (!u) return Response.json({ balanceCents: 0, debtCents: 0 }, { status: 404 });
  return Response.json({
    balanceCents: u.balanceCents,
    debtCents: accruedDebtCents(u.debtCents, u.debtRateBps, u.debtSince),
    autoRepay: u.autoRepay,
  });
}
