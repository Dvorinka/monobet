import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/session";
import { MarketForm } from "@/components/market-form";

export const metadata: Metadata = { title: "Create a market" };

export default async function ProposePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return (
    <div className="mx-auto max-w-xl px-4 pt-10">
      <h1 className="text-[22px] font-bold tracking-tight">Create a market</h1>
      <p className="text-[13px] text-mute mt-1 mb-6">
        It goes live for everyone instantly. You set the starting odds — the crowd takes it from there.
      </p>
      <MarketForm isAdmin={user.role === "admin"} />
    </div>
  );
}
