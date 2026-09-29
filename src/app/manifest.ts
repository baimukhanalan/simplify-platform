import type { MetadataRoute } from "next";

/** Mint atmosphere from the design tokens (globals.css): the body background and the top of its gradient. */
const PWA_BACKGROUND = "#eaf5ef";
const PWA_THEME = "#dcefe6";

/** Web App Manifest: Simplify installs to the home screen / dock and opens straight into the app. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/app",
    name: "Simplify",
    short_name: "Simplify",
    description: "Карьерный ИИ-агент: находит вакансии, подаёт заявки и ведёт тебя до оффера.",
    lang: "ru",
    dir: "ltr",
    start_url: "/app",
    scope: "/",
    display: "standalone",
    background_color: PWA_BACKGROUND,
    theme_color: PWA_THEME,
    categories: ["business", "productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Сегодня", short_name: "Сегодня", url: "/app", icons: [{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }] },
      { name: "Интервью", short_name: "Интервью", url: "/app/interviews", icons: [{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }] },
    ],
  };
}
