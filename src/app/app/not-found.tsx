import Link from "next/link";
import { getT } from "@/lib/i18n/server";

export default async function AppNotFound() {
  const t = await getT();
  return (
    <div className="glass mx-auto mt-10 flex max-w-lg flex-col items-center gap-4 px-6 py-12 text-center animate-rise">
      <span className="label">404</span>
      <h1 className="h-serif text-[30px]">{t("errors.appNotFoundTitle")}</h1>
      <p className="text-[14.5px] text-ink-3">{t("errors.appNotFoundText")}</p>
      <Link href="/app" className="inline-flex h-11 items-center rounded-full bg-cta px-5 text-[14.5px] font-medium text-white shadow-(--shadow-cta) focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-green">{t("errors.backToToday")}</Link>
    </div>
  );
}
