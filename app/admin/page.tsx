import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/session";
import { getPendingMarkets, listMarkets, getAllUsers, listCategories, listCategoryRows } from "@/lib/queries";
import { PendingList, LiveMarketList, GrantPanel, CategoriesPanel } from "@/components/admin-panels";
import { MarketForm } from "@/components/market-form";
import { getLang } from "@/lib/lang-server";
import { getT } from "@/lib/i18n";
import { Card } from "@/components/ui/primitives";
import { ShieldCheck, Inbox, Radio, Users, PlusCircle, Tags } from "lucide-react";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Admin" };

export default async function AdminPage() {
  const [user, lang] = await Promise.all([getCurrentUser(), getLang()]);
  if (!user) redirect("/login");
  if (user.role !== "admin") redirect("/");
  const t = getT(lang);

  const [pending, live, users, categories, categoryRows] = await Promise.all([
    getPendingMarkets(),
    listMarkets({ includeOptions: true }),
    getAllUsers(),
    listCategories(),
    listCategoryRows(),
  ]);

  return (
    <div className="mx-auto max-w-5xl px-4 pt-8">
      <h1 className="text-[22px] font-bold tracking-tight flex items-center gap-2">
        <ShieldCheck className="size-5" /> {t.adminTitle}
      </h1>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section className="lg:col-span-2">
          <SectionTitle icon={<Inbox className="size-4" />} title={t.pendingProposals(pending.length)} />
          <Card className="overflow-hidden">
            <PendingList
              lang={lang}
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
          <SectionTitle icon={<Radio className="size-4" />} title={t.liveMarkets(live.length)} />
          <Card className="overflow-hidden">
            <LiveMarketList
              lang={lang}
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
            <SectionTitle icon={<PlusCircle className="size-4" />} title={t.createMarketTitle} />
            <MarketForm isAdmin categories={categories} lang={lang} />
          </section>

          <section>
            <SectionTitle icon={<Tags className="size-4" />} title={t.categoriesTitle} />
            <Card>
              <CategoriesPanel categories={categoryRows} lang={lang} />
            </Card>
          </section>

          <section>
            <SectionTitle icon={<Users className="size-4" />} title={t.grantBalance} />
            <Card>
              <GrantPanel users={users.map((u) => ({ id: u.id, username: u.username, balanceCents: u.balanceCents }))} lang={lang} />
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
