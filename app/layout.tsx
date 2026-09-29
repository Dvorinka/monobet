import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { Toaster } from "sonner";
import { SiteHeader } from "@/components/site-header";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: { default: "MonoMark", template: "%s · MonoMark" },
  description: "Play-money prediction markets. Bet virtual Marks on custom events.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="min-h-dvh flex flex-col">
        <SiteHeader />
        <main className="flex-1">{children}</main>
        <footer className="border-t border-line mt-16">
          <div className="mx-auto max-w-6xl px-4 py-8 flex flex-col sm:flex-row items-center justify-between gap-3 text-[13px] text-mute">
            <div className="flex items-center gap-2">
              <div className="grid place-items-center size-5 rounded bg-ink text-white text-[10px] font-bold">M</div>
              <span className="font-semibold text-ink">MonoMark</span>
            </div>
            <p>Play-money prediction markets. Not financial advice — not even real money.</p>
          </div>
        </footer>
        <Toaster position="bottom-center" toastOptions={{ style: { fontFamily: "var(--font-sans)" } }} />
      </body>
    </html>
  );
}
