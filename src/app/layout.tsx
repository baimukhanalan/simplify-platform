import type { Metadata, Viewport } from "next";
import { Inter, Pinyon_Script, Source_Serif_4, JetBrains_Mono, Great_Vibes } from "next/font/google";
import "./globals.css";
import { getLocale, getT } from "@/lib/i18n/server";
import { I18nScope } from "@/lib/i18n/scope";

const inter = Inter({ subsets: ["latin", "cyrillic", "cyrillic-ext"], variable: "--font-inter" });
const pinyon = Pinyon_Script({ subsets: ["latin"], weight: "400", variable: "--font-pinyon", adjustFontFallback: false });
// The brand fonts (STK Bureau Serif, PP Supply Mono) have no Cyrillic glyphs: these carry Russian text
// in a matching style via per-glyph fallback in the font stacks (globals.css). cyrillic-ext carries the Kazakh letters
// (Ә Ғ Қ Ң Ө Ұ Ү Һ І); unicode-range means it is only downloaded on pages that use them.
const serifCyr = Source_Serif_4({ subsets: ["cyrillic", "cyrillic-ext"], weight: ["400"], variable: "--font-serif-cyr", adjustFontFallback: false });
const scriptCyr = Great_Vibes({ subsets: ["cyrillic", "cyrillic-ext"], weight: "400", variable: "--font-script-cyr", adjustFontFallback: false });
const monoCyr = JetBrains_Mono({ subsets: ["cyrillic", "cyrillic-ext"], weight: ["400"], variable: "--font-mono-cyr", adjustFontFallback: false });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:3210")),
  title: { default: "Simplify — карьерный ИИ-агент", template: "%s · Simplify" },
  description: "Tell us what job you want. We handle the rest. Stop applying. Start interviewing.",
  icons: { icon: [{ url: "/brand/favicon.svg", type: "image/svg+xml" }, { url: "/brand/favicon.png" }], apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }] },
  openGraph: { images: ["/brand/og_image.jpg"] },
  // PWA (manifest: src/app/manifest.ts): home-screen icon and standalone mode on iOS.
  appleWebApp: { capable: true, title: "Simplify", statusBarStyle: "default" },
  other: { "apple-mobile-web-app-capable": "yes" },
};

export const viewport: Viewport = { themeColor: "#dcefe6" };

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const [locale, t] = await Promise.all([getLocale(), getT()]);
  return (
    <html lang={locale} className={`${inter.variable} ${pinyon.variable} ${serifCyr.variable} ${monoCyr.variable} ${scriptCyr.variable}`}>
      <body>
        <a href="#main-content" className="skip-link">{t("common.skipLink")}</a>
        <I18nScope ns={["common", "switcher", "legalChrome"]}>{children}</I18nScope>
      </body>
    </html>
  );
}
