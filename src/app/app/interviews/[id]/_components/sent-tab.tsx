import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import type { ApplicationPackage } from "@prisma/client";
import { j } from "@/lib/db";
import { Card, Chip, Empty, Label } from "@/components/ui";
import { CopyButton } from "../../_components/copy-button";
import { SentAnswer } from "../../../../_components/sent-answer";
import { hasCyrillic } from "@/lib/engine/taxonomy";
import { getT } from "@/lib/i18n/server";
import { SOURCE_LABEL } from "@/lib/ops";

type Answer = { q: string; a: string; category?: string; status?: string; kind?: string };

export async function SentTab({ pkg, company, submittedAt, opportunityId, debug }: { pkg: ApplicationPackage | null; company: string; submittedAt: Date | null; opportunityId: string; debug?: boolean }) {
  const t = await getT();
  if (!pkg) return <Empty title={t("interviewsPage.sent.noPkgTitle")} sub={t("interviewsPage.sent.noPkgSub")} />;
  const answers = j<Answer[]>(pkg.answers, []);
  const m = pkg.submitMethod;
  // Same rule as lib/ops submitMethodLabel: the internal corpus (ats:demo / ats:seed) never shows its source id.
  const method = m.startsWith("ats:demo") || m.startsWith("ats:seed") ? t("interviewsPage.sent.viaForm")
    : m.startsWith("ats:") ? t("interviewsPage.sent.viaAts", { ats: SOURCE_LABEL[m.slice(4)] ?? m.slice(4) })
      : m === "user-handoff" ? t("interviewsPage.sent.byYou") : t("interviewsPage.sent.notSent");
  const cvLabel = t("interviewsPage.sent.cvFor", { company });
  // What went to the employer is content in its own language (not UI): marked by script.
  const langOf = (s: string) => (hasCyrillic(s) ? "ru" : "en");
  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Label className="mb-1.5">{t("interviewsPage.sent.whatSent", { company })}</Label>
          <p className="text-[14px] text-ink-2">{t("interviewsPage.sent.reread")}</p>
          <Link href={`/app/applications/${opportunityId}`} className="mt-1 inline-flex min-h-10 items-center gap-1 rounded text-[13px] text-teal underline-offset-4 hover:text-head hover:underline focus-visible:outline-2 focus-visible:outline-green">
            {t("interviewsPage.sent.openApp")}<ArrowUpRight className="size-3.5" strokeWidth={1.7} aria-hidden />
          </Link>
        </div>
        <div className="flex flex-wrap gap-2">
          <Chip tone="dark" wrap>{cvLabel}</Chip>
          {pkg.generatedBy === "claude" && <Chip tone="green">Claude</Chip>}
          {debug && <Chip>by: {pkg.generatedBy || "—"} · {pkg.submitMethod || "—"}</Chip>}
          <Chip wrap>{method}</Chip>
          {submittedAt && <Chip>{t.date(submittedAt, "dayMonthShort")}</Chip>}
        </div>
      </Card>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <Card>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h2 className="h-serif min-w-0 break-words text-[22px]">{cvLabel}</h2>
            <CopyButton text={pkg.cvText} />
          </div>
          {/* The summary opens the CV text itself — repeat it only when the CV doesn't already contain it. */}
          {pkg.summary && !pkg.cvText.includes(pkg.summary.trim().slice(0, 80)) && <p lang={langOf(pkg.summary)} className="mb-3 border-l-2 border-green/40 pl-3 text-[14px] italic text-ink-2">{pkg.summary}</p>}
          <pre tabIndex={0} aria-label={t("interviewsPage.sent.cvAria")} lang={langOf(pkg.cvText)} className="scroll-thin max-h-[520px] overflow-auto whitespace-pre-wrap rounded-2xl border border-line bg-white/60 p-4 font-sans text-[13.5px] leading-relaxed text-ink-2 focus-visible:outline-2 focus-visible:outline-green">{pkg.cvText}</pre>
        </Card>
        <div className="flex flex-col gap-4">
          <Card>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <h2 className="h-serif min-w-0 break-words text-[22px]">{t("interviewsPage.sent.cover")}</h2>
              {pkg.coverLetter && <CopyButton text={pkg.coverLetter} />}
            </div>
            {pkg.coverLetter ? <p lang={langOf(pkg.coverLetter)} className="whitespace-pre-wrap text-[14px] leading-relaxed text-ink-2">{pkg.coverLetter}</p> : <p className="text-[14px] text-ink-3">{t("interviewsPage.sent.noCover")}</p>}
          </Card>
          <Card>
            <h2 className="h-serif mb-3 text-[22px]">{t("interviewsPage.sent.answers")}</h2>
            {answers.length === 0 ? (
              <p className="text-[14px] text-ink-3">{t("interviewsPage.sent.noAnswers")}</p>
            ) : (
              <dl className="flex flex-col divide-y divide-line">
                {answers.map((a, i) => (
                  <div key={i} className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0">
                    <dt lang={langOf(a.q)} className="text-[13px] text-ink-3">{a.q}</dt>
                    <dd className="text-[14px] text-head">
                      {/* ru: the answer as the user reads it (SentAnswer); kk/en: exactly what the employer received. */}
                      {a.a ? (t.locale === "ru" ? <SentAnswer answer={a.a} /> : <span lang={langOf(a.a)}>{a.a}</span>) : <span className="text-amber">{a.status === "pending" ? t("interviewsPage.sent.pendingAnswer") : t("interviewsPage.sent.emptyAnswer")}</span>}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
