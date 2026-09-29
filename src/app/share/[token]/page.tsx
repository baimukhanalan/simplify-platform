import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { Logo } from "@/components/ui";
import { plural } from "../../_components/ru";
import { headline, loadShare, statsLine } from "./data";

type Props = { params: Promise<{ token: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { token } = await params;
  const d = await loadShare(token);
  if (!d) return { title: "Simplify", robots: { index: false, follow: false } };
  const title = headline(d);
  const description = `${statsLine(d)} — вместе с Simplify, персональным карьерным ИИ-агентом.`;
  return {
    title: { absolute: `${title} · Simplify` },
    description,
    robots: { index: false, follow: true }, // personal page: shareable, not indexed
    openGraph: { title, description, type: "website", siteName: "Simplify" },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function SharePage({ params }: Props) {
  const { token } = await params;
  const d = await loadShare(token);
  if (!d) notFound();

  const stats: { v: number; l: string }[] = [
    { v: d.applications, l: plural(d.applications, ["заявка", "заявки", "заявок"]) },
    { v: d.interviews, l: "интервью" },
    ...(d.daysToOffer != null ? [{ v: d.daysToOffer, l: `${plural(d.daysToOffer, ["день", "дня", "дней"])} до оффера` }] : []),
  ];

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col px-4 py-6 sm:px-8 sm:py-10">
      <header className="flex items-center justify-between gap-4">
        <Link href="/" className="inline-flex min-h-10 shrink-0 items-center rounded focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-green"><Logo /></Link>
        <span className="label">История поиска</span>
      </header>

      <article aria-labelledby="share-h" className="relative isolate mt-8 flex flex-1 flex-col overflow-hidden rounded-[32px] bg-[#0c1512] px-6 py-10 text-white shadow-[0_30px_80px_-30px_rgb(12_21_18/.6)] sm:mt-10 sm:px-12 sm:py-14">
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
          <div className="absolute -right-40 -top-40 size-[600px] rounded-full bg-[radial-gradient(circle,rgb(127_227_182/.2),transparent_62%)]" />
          <svg className="absolute -right-[20%] top-1/2 h-[140%] -translate-y-1/2 opacity-[.15]" viewBox="0 0 200 200" fill="none">
            {[22, 38, 54, 70, 86, 99].map((r) => <circle key={r} cx="100" cy="100" r={r} stroke="#8fc7ad" strokeWidth=".3" />)}
          </svg>
        </div>

        <span className="animate-fade font-mono text-[11px] uppercase tracking-[.14em] text-[#8fc7ad]">Career Campaign · HIRED</span>
        <h1 id="share-h" className="mt-6 flex flex-col gap-4">
          <span className="h-serif animate-rise text-[clamp(72px,17vw,188px)] leading-[.84] tracking-[-0.03em] !text-white">HIRED<span className="text-[#7fe3b6]">.</span></span>
          <span className="h-serif animate-rise text-[clamp(26px,4vw,44px)] !text-white/90" style={{ animationDelay: "60ms" }}>
            {d.name} <span className="script !text-[#7fe3b6]">получает оффер</span>
          </span>
        </h1>
        {(d.role || d.company) && (
          <p className="mt-6 max-w-3xl animate-rise text-[clamp(19px,2.4vw,28px)] leading-snug text-white/85" style={{ animationDelay: "100ms" }}>
            {d.role}
            {d.role && d.company && <span className="text-white/45"> · </span>}
            {d.company && <span className="text-white">{d.company}</span>}
          </p>
        )}

        <dl className="mt-12 grid max-w-3xl animate-rise grid-cols-2 gap-6 sm:grid-cols-3" style={{ animationDelay: "200ms" }}>
          {stats.map((x) => (
            <div key={x.l} className="flex flex-col-reverse gap-1 border-l border-white/15 pl-4">
              <dt className="text-[13px] text-white/55">{x.l}</dt>
              <dd className="num text-[clamp(40px,6vw,64px)] leading-none">{x.v}</dd>
            </div>
          ))}
        </dl>

        <p className="mt-auto max-w-xl pt-12 text-[14px] leading-relaxed text-white/60">
          Весь поиск вёл персональный карьерный ИИ-агент Simplify: подбор вакансий, заявки, подготовка к интервью и переговоры по офферу.
        </p>
      </article>

      <section aria-label="Simplify" className="glass mt-5 flex flex-col items-start gap-4 p-6 sm:flex-row sm:items-center sm:justify-between sm:p-8">
        <div>
          <p className="h-serif text-[clamp(22px,2.6vw,30px)]">Твоя очередь.</p>
          <p className="mt-1 text-[14px] text-ink-3">Скажи, какую работу хочешь — остальное сделает агент.</p>
        </div>
        <Link href="/" className="inline-flex h-12 items-center gap-2 rounded-full bg-cta px-6 text-[15px] font-medium text-white shadow-(--shadow-cta) transition hover:bg-[#2f2c2c] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-green">
          Запустить свою кампанию<ArrowRight className="size-4" strokeWidth={1.8} aria-hidden />
        </Link>
      </section>
    </main>
  );
}
