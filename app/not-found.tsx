import Link from "next/link";
import { getLang } from "@/lib/lang-server";
import { getT } from "@/lib/i18n";
import { Button } from "@/components/ui/primitives";
import { LogoMark } from "@/components/logo";

export default async function NotFound() {
  const lang = await getLang();
  const t = getT(lang);

  return (
    <div className="mx-auto max-w-sm px-4 pt-24 text-center">
      <LogoMark className="size-12 mx-auto" />
      <h1 className="mt-4 text-[22px] font-bold tracking-tight">{t.notFoundTitle}</h1>
      <p className="mt-1.5 text-[13.5px] text-mute">{t.notFoundBody}</p>
      <Link href="/">
        <Button className="mt-5">{t.backToMarkets}</Button>
      </Link>
    </div>
  );
}
