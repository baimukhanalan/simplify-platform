import Link from "next/link";
import { Logo } from "@/components/ui";

export function LegalPage({ eyebrow, title, sections }: { eyebrow: string; title: string; sections: { h: string; p: string[] }[] }) {
  return (
    <main className="mx-auto max-w-3xl px-5 py-10 sm:py-16">
      <Link href="/" className="inline-block"><Logo /></Link>
      <div className="mt-12 animate-rise">
        <div className="label">{eyebrow}</div>
        <h1 className="h-serif mt-3 text-[clamp(34px,5vw,54px)]">{title}</h1>
        <p className="mt-3 text-[13px] text-ink-3">Черновик для пилота. Финальная редакция утверждается юристом до коммерческого запуска.</p>
      </div>
      <div className="glass mt-10 flex flex-col gap-8 p-6 sm:p-9">
        {sections.map((s) => (
          <section key={s.h} className="flex flex-col gap-2.5">
            <h2 className="h-serif text-[22px]">{s.h}</h2>
            {s.p.map((x, i) => <p key={i} className="text-[15px] leading-relaxed text-ink-2">{x}</p>)}
          </section>
        ))}
      </div>
    </main>
  );
}
