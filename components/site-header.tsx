import Link from "next/link";
import { Plus } from "lucide-react";
import { LogoMark } from "@/components/logo";
import { getCurrentUser, isAdmin } from "@/lib/session";
import { getNotifications } from "@/lib/queries";
import { NotifBell } from "@/components/notif-bell";
import { getLang } from "@/lib/lang-server";
import { getT } from "@/lib/i18n";
import { SearchBox } from "@/components/search-box";
import { AnimatedMoney } from "@/components/animated-number";
import { UserMenu } from "@/components/user-menu";
import { ClaimButton } from "@/components/claim-button";
import { Button } from "@/components/ui/primitives";
import { ThemeToggle } from "@/components/theme-toggle";
import { LangToggle } from "@/components/lang-toggle";
import { DAILY_COOLDOWN_MS } from "@/lib/rewards";

export async function SiteHeader() {
  const [user, lang] = await Promise.all([getCurrentUser(), getLang()]);
  const t = getT(lang);
  const notifs = user ? await getNotifications(user.id) : [];

  return (
    <header className="sticky top-0 z-40 bg-surface/95 backdrop-blur border-b border-line">
      <div className="mx-auto max-w-6xl px-4 h-14 flex items-center gap-4">
        <Link href="/" className="flex items-center gap-2 shrink-0 group/logo">
          <LogoMark className="transition-transform duration-300 group-hover/logo:rotate-[-6deg] group-hover/logo:scale-105" />
          <span className="font-bold text-[17px] tracking-tight hidden sm:block">MonoBet</span>
        </Link>

        <nav className="hidden md:flex items-center gap-1 text-[13.5px] font-medium text-mute">
          <Link href="/" className="px-2.5 py-1.5 rounded-md hover:text-ink hover:bg-surface-2">
            {t.markets}
          </Link>
          <Link href="/leaderboard" className="px-2.5 py-1.5 rounded-md hover:text-ink hover:bg-surface-2">
            {t.leaderboard}
          </Link>
          <Link href="/games" className="px-2.5 py-1.5 rounded-md hover:text-ink hover:bg-surface-2">
            {t.games}
          </Link>
          {user && (
            <Link href="/portfolio" className="px-2.5 py-1.5 rounded-md hover:text-ink hover:bg-surface-2">
              {t.portfolio}
            </Link>
          )}
        </nav>

        <div className="flex-1 max-w-sm ml-auto">
          <SearchBox lang={lang} />
        </div>

        <Link
          href="/propose"
          className="hidden sm:inline-flex items-center gap-1 h-8 px-3 rounded-lg bg-brand text-brand-on text-[13px] font-semibold hover:bg-brand-strong transition-all duration-150 active:scale-[0.97] shrink-0"
          title={t.createMarket}
        >
          <Plus className="size-3.5" />
          {t.newMarket}
        </Link>

        {user ? (
          <div className="flex items-center gap-2 shrink-0">
            <ClaimButton
              lang={lang}
              nextAt={user.lastClaimAt ? new Date(user.lastClaimAt).getTime() + DAILY_COOLDOWN_MS : null}
            />
            <Link
              href="/portfolio"
              className="num hidden sm:inline-flex items-center h-9 px-3 rounded-lg bg-surface-2 text-sm font-semibold hover:bg-surface-3"
              title={t.yourBalance}
            >
              <AnimatedMoney cents={user.balanceCents} lang={lang} />
            </Link>
            <NotifBell items={notifs} lang={lang} />
            <UserMenu name={user.name} username={user.username} role={isAdmin(user) ? "admin" : user.role} image={user.image} lang={lang} />
          </div>
        ) : (
          <div className="flex items-center gap-2 shrink-0">
            <Link href="/login">
              <Button variant="ghost" size="sm">
                {t.logIn}
              </Button>
            </Link>
            <Link href="/login?mode=signup">
              <Button size="sm">{t.signUp}</Button>
            </Link>
          </div>
        )}
        <LangToggle />
        <ThemeToggle lang={lang} />
      </div>
    </header>
  );
}
