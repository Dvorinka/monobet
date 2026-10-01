import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getNotifications } from "@/lib/queries";

// Lightweight poll for the header bell — reads the session directly so the
// presence roll in getCurrentUser doesn't write on every tick.
export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user?.id) return Response.json({ items: [] }, { status: 401 });
  const items = await getNotifications(session.user.id);
  return Response.json({ items });
}
