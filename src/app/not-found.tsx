import Link from "next/link";
import { Logo } from "@/components/ui";

export const metadata = { title: "Страница не найдена" };

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col items-center justify-center gap-6 px-5 text-center">
      <Link href="/"><Logo /></Link>
      <div className="flex flex-col gap-3 animate-rise">
        <span className="label">404</span>
        <h1 className="h-serif text-[clamp(34px,6vw,54px)]">Здесь <span className="script">ничего</span> нет</h1>
        <p className="text-[15px] text-ink-2">Ссылка устарела или страница переехала. Агент продолжает работать — вернись в кабинет.</p>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        <Link href="/app" className="inline-flex h-11 items-center rounded-full bg-cta px-5 text-[14.5px] font-medium text-white shadow-(--shadow-cta) hover:bg-[#2f2c2c] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-green">Открыть Today</Link>
        <Link href="/" className="glass inline-flex h-11 items-center !rounded-full px-5 text-[14.5px] text-head hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-green">На главную</Link>
      </div>
    </main>
  );
}
