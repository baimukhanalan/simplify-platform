import Link from "next/link";
import { Logo } from "@/components/ui";
import { currentUserId } from "@/lib/auth";

export const metadata = { title: "Страница не найдена" };

const primary = "inline-flex h-11 items-center rounded-full bg-cta px-5 text-[14.5px] font-medium text-white shadow-(--shadow-cta) hover:bg-[#2f2c2c] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-green";
const secondary = "glass inline-flex h-11 items-center !rounded-full px-5 text-[14.5px] text-head hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-green";

/** Signed-in visitors are sent back to their cabinet; everyone else gets the landing page and sign-in — no agent talk. */
export default async function NotFound() {
  const signedIn = Boolean(await currentUserId());
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col items-center justify-center gap-6 px-5 text-center">
      <Link href="/" aria-label="Simplify — на главную" className="inline-flex min-h-10 items-center rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-green"><Logo /></Link>
      <div className="flex flex-col gap-3 animate-rise">
        <span className="label">404</span>
        <h1 className="h-serif text-[clamp(34px,6vw,54px)]">Здесь <span className="script">ничего</span> нет</h1>
        <p className="text-[15px] text-ink-2">
          {signedIn ? "Ссылка устарела или страница переехала. Агент продолжает работать — вернись в кабинет." : "Ссылка устарела или страница переехала."}
        </p>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        {signedIn ? (
          <>
            <Link href="/app" className={primary}>Открыть Today</Link>
            <Link href="/" className={secondary}>На главную</Link>
          </>
        ) : (
          <>
            <Link href="/" className={primary}>На главную</Link>
            <Link href="/login" className={secondary}>Войти</Link>
          </>
        )}
      </div>
    </main>
  );
}
