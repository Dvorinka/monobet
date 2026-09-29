import { headers } from "next/headers";
import { auth } from "@/lib/auth";

export type CurrentUser = {
  id: string;
  name: string;
  username: string | null;
  role: string;
  balanceCents: number;
  lastClaimAt: Date | null;
};

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return null;
  const u = session.user as typeof session.user & {
    role?: string;
    balanceCents?: number;
    lastClaimAt?: Date | null;
    username?: string | null;
  };
  return {
    id: u.id,
    name: u.name,
    username: u.username ?? null,
    role: u.role ?? "user",
    balanceCents: u.balanceCents ?? 0,
    lastClaimAt: u.lastClaimAt ?? null,
  };
}

export async function requireUser(): Promise<CurrentUser> {
  const u = await getCurrentUser();
  if (!u) throw new Error("Sign in required");
  return u;
}

export async function requireAdmin(): Promise<CurrentUser> {
  const u = await requireUser();
  if (u.role !== "admin") throw new Error("Admin only");
  return u;
}
