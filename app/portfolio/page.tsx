import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/session";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Portfolio" };

// Portfolio merged into the profile page — /u/[me] shows the private
// sections (balance history, trades, cash flow) to the owner only.
export default async function PortfolioPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  redirect(`/u/${encodeURIComponent(user.username ?? user.name)}`);
}
