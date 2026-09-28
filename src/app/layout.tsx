import type { Metadata } from "next";
import { Inter, Pinyon_Script, Source_Serif_4, JetBrains_Mono, Great_Vibes } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin", "cyrillic"], variable: "--font-inter" });
const pinyon = Pinyon_Script({ subsets: ["latin"], weight: "400", variable: "--font-pinyon", adjustFontFallback: false });
// The brand fonts (STK Bureau Serif, PP Supply Mono) have no Cyrillic glyphs: these carry Russian text
// in a matching style via per-glyph fallback in the font stacks (globals.css).
const serifCyr = Source_Serif_4({ subsets: ["cyrillic"], weight: ["400"], variable: "--font-serif-cyr", adjustFontFallback: false });
const scriptCyr = Great_Vibes({ subsets: ["cyrillic"], weight: "400", variable: "--font-script-cyr", adjustFontFallback: false });
const monoCyr = JetBrains_Mono({ subsets: ["cyrillic"], weight: ["400"], variable: "--font-mono-cyr", adjustFontFallback: false });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:3210")),
  title: { default: "Simplify — карьерный ИИ-агент", template: "%s · Simplify" },
  description: "Tell us what job you want. We handle the rest. Stop applying. Start interviewing.",
  icons: { icon: [{ url: "/brand/favicon.svg", type: "image/svg+xml" }, { url: "/brand/favicon.png" }] },
  openGraph: { images: ["/brand/og_image.jpg"] },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru" className={`${inter.variable} ${pinyon.variable} ${serifCyr.variable} ${monoCyr.variable} ${scriptCyr.variable}`}>
      <body>{children}</body>
    </html>
  );
}
