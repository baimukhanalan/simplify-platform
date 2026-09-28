import { ImageResponse } from "next/og";
import { headline, loadShare } from "./data";
import { plural } from "@/app/app/hired/_lib/journey";

export const alt = "HIRED. — история поиска с Simplify";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const d = await loadShare(token);
  const title = d ? headline(d).replace(/:\s*HIRED\.\s*/, " · ").replace(/:\s*HIRED\.$/, "") : "Новая работа вместе с Simplify";
  // Role/company are clamped in loadShare; long (e.g. Kazakh) titles still get a smaller size to stay inside the card.
  // Default next/og font (Geist) covers Cyrillic incl. Kazakh letters, so names/roles render without transliteration.
  const titleSize = title.length > 110 ? 30 : title.length > 70 ? 34 : 40;
  const stats = d
    ? [
        [String(d.applications), plural(d.applications, ["заявка", "заявки", "заявок"])],
        [String(d.interviews), "интервью"],
        ...(d.daysToOffer != null ? [[String(d.daysToOffer), `${plural(d.daysToOffer, ["день", "дня", "дней"])} до оффера`]] : []),
      ]
    : [];

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: "#0c1512", color: "white", padding: "64px 72px", position: "relative" }}>
        <div style={{ position: "absolute", right: -220, top: -220, width: 720, height: 720, borderRadius: 9999, background: "radial-gradient(circle, rgba(127,227,182,.28), rgba(12,21,18,0) 62%)", display: "flex" }} />
        <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 22, letterSpacing: 4, color: "#8fc7ad" }}>
          <span>SIMPLIFY</span>
          <span style={{ width: 40, height: 1, background: "rgba(143,199,173,.5)" }} />
          <span>HIRED</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 150, lineHeight: 0.9, letterSpacing: -4, display: "flex" }}>
            HIRED<span style={{ color: "#7fe3b6" }}>.</span>
          </div>
          <div style={{ marginTop: 28, fontSize: titleSize, lineHeight: 1.2, color: "rgba(255,255,255,.88)", maxWidth: 1000, display: "flex" }}>{title}</div>
        </div>
        <div style={{ display: "flex", gap: 64 }}>
          {stats.map(([v, l]) => (
            <div key={l} style={{ display: "flex", flexDirection: "column", borderLeft: "2px solid rgba(255,255,255,.18)", paddingLeft: 20 }}>
              <span style={{ fontSize: 60, lineHeight: 1 }}>{v}</span>
              <span style={{ fontSize: 22, color: "rgba(255,255,255,.55)", marginTop: 6 }}>{l}</span>
            </div>
          ))}
        </div>
      </div>
    ),
    size,
  );
}
