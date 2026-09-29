"use client";

import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { signIn, signUp } from "@/lib/auth-client";
import { Button, Card, Input, Segmented } from "@/components/ui/primitives";
import { LogoMark } from "@/components/logo";

export function AuthForm() {
  const params = useSearchParams();
  const [mode, setMode] = useState<"login" | "signup">(
    params.get("mode") === "signup" ? "signup" : "login"
  );
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();

  const submit = () => {
    if (username.trim().length < 3) return toast.error("Username needs at least 3 characters");
    if (password.length < 6) return toast.error("Password needs at least 6 characters");
    start(async () => {
      if (mode === "signup") {
        const r = await signUp.email({
          // username plugin stores username; email is required by core, so a
          // local placeholder keeps signups friction-free.
          email: `${username.trim().toLowerCase()}@monomark.local`,
          name: username.trim(),
          username: username.trim().toLowerCase(),
          password,
        });
        if (r.error) {
          toast.error(r.error.message ?? "Sign up failed");
          return;
        }
        toast.success("Welcome to MonoMark — Ɱ1,000 credited");
      } else {
        const r = await signIn.username({ username: username.trim().toLowerCase(), password });
        if (r.error) {
          toast.error("Wrong username or password");
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
        <span className="font-bold text-[17px] tracking-tight">MonoMark</span>
      </div>

      <Segmented
        options={[
          { value: "login", label: "Log in" },
          { value: "signup", label: "Sign up" },
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
            Username
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
        <div>
          <label className="text-[13px] font-medium text-mute" htmlFor="p">
            Password
          </label>
          <Input
            id="p"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={mode === "signup" ? "min 6 characters" : "••••••••"}
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            className="mt-1"
          />
        </div>

        <Button className="w-full" size="lg" disabled={pending}>
          {pending ? "…" : mode === "login" ? "Log in" : "Create account — get Ɱ1,000"}
        </Button>
      </form>

      <p className="mt-4 text-center text-[12px] text-faint">
        Play money only. No deposits, no withdrawals, no regrets.
      </p>
    </Card>
  );
}
