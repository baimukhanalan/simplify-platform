import Link from "next/link";
import { Logo } from "@/components/ui";
import { currentUser } from "@/lib/auth";
import { getT } from "@/lib/i18n/server";
import { LocaleSwitcher } from "@/components/locale-switcher";

export async function generateMetadata() {
  return { title: (await getT())("meta.notFound") };
}

const primary = "inline-flex h-11 items-center rounded-full bg-cta px-5 text-[14.5px] font-medium text-white shadow-(--shadow-cta) hover:bg-[#2f2c2c] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-green";
const secondary = "glass inline-flex h-11 items-center !rounded-full px-5 text-[14.5px] text-head hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-green";

/** Signed-in visitors are sent back to their cabinet; everyone else gets the landing page and sign-in — no agent talk. */
export default async function NotFound() {
  const [signedIn, t] = await Promise.all([currentUser().then(Boolean), getT()]);
  return (
    <main id="main-content" tabIndex={-1} className="mx-auto flex min-h-dvh max-w-xl flex-col items-center justify-center gap-6 px-5 text-center">
      <Link href="/" aria-label={t("common.homeAria")} className="inline-flex min-h-10 shrink-0 items-center rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-green"><Logo /></Link>
      <div className="flex flex-col gap-3 animate-rise">
        <span className="label">404</span>
        <h1 className="h-serif text-[clamp(34px,6vw,54px)]">{t.rich("errors.notFoundTitle", {}, { s: (c) => <span className="script">{c}</span> })}</h1>
        <p className="text-[15px] text-ink-2">
          {signedIn ? t("errors.notFoundSignedIn") : t("errors.notFoundSignedOut")}
        </p>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        {signedIn ? (
          <>
            <Link href="/app" className={primary}>{t("errors.openToday")}</Link>
            <Link href="/" className={secondary}>{t("common.home")}</Link>
          </>
        ) : (
          <>
            <Link href="/" className={primary}>{t("common.home")}</Link>
            <Link href="/login" className={secondary}>{t("common.signIn")}</Link>
          </>
        )}
      </div>
      <LocaleSwitcher />
    </main>
  );
}
