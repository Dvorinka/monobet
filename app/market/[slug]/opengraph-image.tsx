import { ImageResponse } from "next/og";
import { getMarketBySlug, getGroupOptions, marketYesPrice } from "@/lib/queries";
import { fmtMarks } from "@/lib/money";

export const alt = "MonoBet market";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const dynamic = "force-dynamic";

const YES = "#0f9d58";
const NO = "#e5484d";
const MUTE = "#8fa899";

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const market = await getMarketBySlug(slug);

  if (!market) {
    return new ImageResponse(
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#141a16", color: "#fff", fontSize: 48 }}>
        Market not found
      </div>,
      size
    );
  }

  const group = market.kind === "group" ? await getGroupOptions(market.id) : [];
  const liveOpts = group.filter((o) => o.status === "live").slice(0, 4);
  const py = marketYesPrice(market);
  const pct = Math.round(py * 100);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#141a16",
          padding: 64,
        }}
      >
        {/* brand row */}
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <svg width="56" height="56" viewBox="0 0 256 256">
            <rect width="256" height="256" rx="56" fill="#0f120e" />
            <path
              d="M58 196 L98 92 L134 166 L182 74"
              fill="none"
              stroke="#ffffff"
              strokeWidth="24"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <circle cx="198" cy="60" r="22" fill={YES} />
          </svg>
          <div style={{ fontSize: 30, fontWeight: 700, color: "#ffffff" }}>MonoBet</div>
          <div
            style={{
              marginLeft: "auto",
              fontSize: 22,
              color: "#141a16",
              background: YES,
              borderRadius: 999,
              padding: "8px 20px",
              fontWeight: 700,
            }}
          >
            {market.status === "resolved" ? "RESOLVED" : market.status === "live" ? "LIVE" : market.status.toUpperCase()}
          </div>
        </div>

        {/* question */}
        <div
          style={{
            fontSize: market.question.length > 90 ? 46 : 56,
            fontWeight: 700,
            color: "#ffffff",
            lineHeight: 1.12,
            maxWidth: 1050,
            overflow: "hidden",
            display: "-webkit-box",
            ...( { WebkitLineClamp: "3", WebkitBoxOrient: "vertical" } as Record<string, string> ),
          }}
        >
          {market.question}
        </div>

        {/* odds */}
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {market.kind === "group" ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {liveOpts.map((o) => {
                const p = Math.round(marketYesPrice(o) * 100);
                return (
                  <div key={o.id} style={{ display: "flex", alignItems: "center", gap: 14 }}>
                    <div style={{ width: 300, fontSize: 24, color: "#dfe8e1", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
                      {o.label ?? o.question}
                    </div>
                    <div style={{ flex: 1, height: 26, borderRadius: 13, background: "#232c26", overflow: "hidden", display: "flex" }}>
                      <div style={{ width: `${Math.max(p, 2)}%`, height: "100%", background: YES }} />
                    </div>
                    <div style={{ width: 70, fontSize: 26, fontWeight: 700, color: "#ffffff", textAlign: "right" }}>{`${p}%`}</div>
                  </div>
                );
              })}
              {liveOpts.length === 0 && <div style={{ fontSize: 30, color: MUTE }}>All options closed</div>}
            </div>
          ) : market.status === "resolved" ? (
            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
              <div
                style={{
                  fontSize: 34,
                  fontWeight: 700,
                  color: "#141a16",
                  background: market.outcome === "yes" ? YES : NO,
                  borderRadius: 12,
                  padding: "12px 28px",
                }}
              >
                {`${(market.outcome ?? "?").toUpperCase()} WON`}
              </div>
            </div>
          ) : (
            <>
              <div style={{ display: "flex", height: 44, borderRadius: 22, overflow: "hidden", width: "100%" }}>
                <div style={{ width: `${Math.max(pct, 4)}%`, background: YES, display: "flex", alignItems: "center", paddingLeft: 22, color: "#fff", fontSize: 26, fontWeight: 700 }}>
                  {`YES ${pct}%`}
                </div>
                <div style={{ flex: 1, background: NO, display: "flex", alignItems: "center", justifyContent: "flex-end", paddingRight: 22, color: "#fff", fontSize: 26, fontWeight: 700 }}>
                  {`NO ${100 - pct}%`}
                </div>
              </div>
            </>
          )}

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ fontSize: 24, color: MUTE }}>
              {`${fmtMarks(market.volumeCents)} traded · ${market.traderCount} traders`}
            </div>
            <div style={{ fontSize: 24, color: MUTE }}>play money only · monobet.tdvorak.dev</div>
          </div>
        </div>
      </div>
    ),
    size
  );
}
