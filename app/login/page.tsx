import { Suspense } from "react";
import type { Metadata } from "next";
import { AuthForm } from "@/components/auth-form";

export const metadata: Metadata = { title: "Log in" };

export default function LoginPage() {
  return (
    <div className="mx-auto max-w-sm px-4 pt-16">
      <Suspense>
        <AuthForm />
      </Suspense>
    </div>
  );
}
