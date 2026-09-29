"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { signIn, signUp } from "@/lib/auth-client";
import { Button, Card, Input, Segmented } from "@/components/ui/primitives";
import { LogoMark } from "@/components/logo";
import { getT, type Lang } from "@/lib/i18n";

export function AuthForm({ lang }: { lang?: Lang }) {
  const params = useSearchParams();
  const t = getT(lang ?? "en");
  const [mode, setMode] = useState<"login" | "signup">(
    params.get("mode") === "signup" ? "signup" : "login"
  );
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();

  const submit = () => {
    if (username.trim().length < 3) return toast.error(t.authUserShort);
    if (password.length < 6) return toast.error(t.authPassShort);
    start(async () => {
      if (mode === "signup") {
        const customEmail = email.trim().toLowerCase();
        const r = await signUp.email({
          // username plugin stores username; email is required by core, so a
          // local placeholder keeps signups friction-free unless a real one
          // is given (e.g. the owner's superadmin email).
          email: customEmail || `${username.trim().toLowerCase()}@monobet.local`,
          name: username.trim(),
          username: username.trim().toLowerCase(),
          password,
        });
        if (r.error) {
          toast.error(r.error.message ?? t.authSignupFailed);
          return;
        }
        toast.success(t.authWelcome);
      } else {
        const r = await signIn.username({ username: username.trim().toLowerCase(), password });
        if (r.error) {
          toast.error(t.authWrongCreds);
          return;
        }
      }
      router.push("/");
      router.refresh();
    });
  };

  return (
    <Card className="p-6">
      <div className="flex items-center gap-2 mb-6">
        <LogoMark />
        <span className="font-bold text-[17px] tracking-tight">MonoBet</span>
      </div>

      <Segmented
        options={[
          { value: "login", label: t.logIn },
          { value: "signup", label: t.signUp },
        ]}
        value={mode}
        onChange={setMode}
      />

      <form
        className="mt-5 space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div>
          <label className="text-[13px] font-medium text-mute" htmlFor="u">
            {t.username}
          </label>
          <Input
            id="u"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="e.g. satoshi"
            autoComplete="username"
            className="mt-1"
          />
        </div>
        {mode === "signup" && (
          <div>
            <label className="text-[13px] font-medium text-mute" htmlFor="e">
              {t.emailOptional}
            </label>
            <Input
              id="e"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              className="mt-1"
            />
          </div>
        )}
        <div>
          <label className="text-[13px] font-medium text-mute" htmlFor="p">
            {t.password}
          </label>
          <Input
            id="p"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={mode === "signup" ? t.passwordPh : "••••••••"}
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            className="mt-1"
          />
        </div>

        <Button className="w-full" size="lg" disabled={pending}>
          {pending ? "…" : mode === "login" ? t.logIn : t.createAccountBtn}
        </Button>
      </form>

      <p className="mt-4 text-center text-[12px] text-faint">
        {t.authPlayMoney}
      </p>
      {mode === "signup" && (
        <p className="mt-1.5 text-center text-[12px] text-faint">
          {t.authAgree}{" "}
          <Link href="/terms" className="underline hover:text-ink">
            {t.termsLink}
          </Link>
          .
        </p>
      )}
    </Card>
  );
}
