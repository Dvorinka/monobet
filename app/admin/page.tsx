import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/session";
import { getPendingMarkets, listMarkets, getAllUsers } from "@/lib/queries";
import { PendingList, LiveMarketList, GrantPanel } from "@/components/admin-panels";
import { MarketForm } from "@/components/market-form";
import { Card } from "@/components/ui/primitives";
import { ShieldCheck, Inbox, Radio, Users, PlusCircle } from "lucide-react";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Admin" };

export default async function AdminPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "admin") redirect("/");

  const [pending, live, users] = await Promise.all([
    getPendingMarkets(),
    listMarkets({ includeOptions: true }),
    getAllUsers(),
  ]);

  return (
    <div className="mx-auto max-w-5xl px-4 pt-8">
      <h1 className="text-[22px] font-bold tracking-tight flex items-center gap-2">
        <ShieldCheck className="size-5" /> Admin
      </h1>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section className="lg:col-span-2">
          <SectionTitle icon={<Inbox className="size-4" />} title={`Pending proposals (${pending.length})`} />
          <Card className="overflow-hidden">
            <PendingList
              items={pending.map(({ market: m, username }) => ({
                id: m.id,
                slug: m.slug,
                question: m.question,
                category: m.category,
                createdAt: m.createdAt,
                username,
              }))}
            />
          </Card>
        </section>

        <section>
          <SectionTitle icon={<Radio className="size-4" />} title={`Live markets (${live.length})`} />
          <Card className="overflow-hidden">
            <LiveMarketList
              items={live.filter((m) => m.kind !== "group").map((m) => ({
                id: m.id,
                slug: m.slug,
                question: m.question,
                category: m.category,
                volumeCents: m.volumeCents,
                traderCount: m.traderCount,
                closesAt: m.closesAt,
              }))}
            />
          </Card>
        </section>

        <div className="space-y-6">
          <section>
            <SectionTitle icon={<PlusCircle className="size-4" />} title="Create market" />
            <MarketForm isAdmin />
          </section>

          <section>
            <SectionTitle icon={<Users className="size-4" />} title="Grant balance" />
            <Card>
              <GrantPanel users={users.map((u) => ({ id: u.id, username: u.username, balanceCents: u.balanceCents }))} />
            </Card>
          </section>
        </div>
      </div>
    </div>
  );
}

function SectionTitle({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <h2 className="text-[14px] font-semibold mb-2.5 flex items-center gap-1.5 text-ink-2">
      {icon}
      {title}
    </h2>
  );
}
