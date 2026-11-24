import type { Metadata } from "next";
import { entryLocale, getT } from "@/lib/i18n/server";
import { I18nScope } from "@/lib/i18n/scope";
import { formToken } from "@/lib/leads";
import { ApplyForm } from "./_components/apply-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT(await entryLocale());
  return { title: t("apply.metaTitle"), description: t("apply.metaDescription") };
}

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/** Public application form — the landing's «Start your campaign» opens /apply?from=landing[&ref=…]. No login needed. */
export default async function ApplyPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const from = one(sp.from) === "landing" ? "landing" : "direct";
  const ref = one(sp.ref).trim().replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64);
  // Like /login: a first-time visitor sees the page in the browser's language.
  const locale = await entryLocale();
  return (
    <div lang={locale} className="contents">
      <I18nScope ns={["common", "switcher", "legalChrome", "apply"]} locale={locale}>
        <ApplyForm token={formToken()} from={from} refCode={ref} />
      </I18nScope>
    </div>
  );
}
