import { Suspense } from "react";
import type { Metadata } from "next";
import { AuthForm } from "@/components/auth-form";
import { getLang } from "@/lib/lang-server";

export const metadata: Metadata = { title: "Log in" };

export default async function LoginPage() {
  const lang = await getLang();
  return (
    <div className="mx-auto max-w-sm px-4 pt-16">
      <Suspense>
        <AuthForm lang={lang} />
      </Suspense>
    </div>
  );
}
