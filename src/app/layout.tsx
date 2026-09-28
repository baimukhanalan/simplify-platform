import type { Metadata } from "next";
import { Inter, Pinyon_Script } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin", "cyrillic"], variable: "--font-inter" });
const pinyon = Pinyon_Script({ subsets: ["latin"], weight: "400", variable: "--font-pinyon" });

export const metadata: Metadata = {
  title: { default: "Simplify — AI Career Agent", template: "%s · Simplify" },
  description: "Tell us what job you want. We handle the rest. Stop applying. Start interviewing.",
  icons: { icon: [{ url: "/brand/favicon.svg", type: "image/svg+xml" }, { url: "/brand/favicon.png" }] },
  openGraph: { images: ["/brand/og_image.jpg"] },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru" className={`${inter.variable} ${pinyon.variable}`}>
      <body>{children}</body>
    </html>
  );
}
