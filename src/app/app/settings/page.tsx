import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Download, History, KeyRound, ShieldCheck, Timer } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db, j } from "@/lib/db";
import { hhEnabled } from "@/lib/hh/client";
import { Card, Label, PageHeader, Script, cx } from "@/components/ui";
import { TelegramCard } from "./_components/telegram-card";
import { PushCard } from "./_components/push-card";
import { updateConsents, type Consents } from "@/lib/actions/account";
import { ActionForm, FormSubmit } from "../profile/_components/action-form";
import { SectionTitle } from "../profile/_components/bits";
import { DeleteAccount } from "./_components/delete-account";
import { AgentStatus } from "../../_components/agent-status";
import { isSimulation } from "@/lib/mode";
import { getT } from "@/lib/i18n/server";
import { I18nScope } from "@/lib/i18n/scope";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("settingsPage.metaTitle") };
}

const CONSENTS = ["autoSubmit", "emailScan", "copilot", "analytics"] as const;
/** Simulation: there are no manual approval or manual status flows to describe — the same consents, neutral wording. */
const HAS_SIM_TEXT = new Set<(typeof CONSENTS)[number]>(["autoSubmit", "emailScan"]);

const PER_PAGE = 20;
const LIMIT = 100;

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const [user, sp, t] = await Promise.all([requireUser(), searchParams, getT()]);
  const consents = j<Consents>(user.consents, {});
  const sim = isSimulation();
  const events = await db.event.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: LIMIT, select: { id: true, type: true, message: true, createdAt: true } });
  const pages = Math.max(1, Math.ceil(events.length / PER_PAGE));
  const page = Math.min(pages, Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1));
  const slice = events.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  return (
    <>
      <PageHeader
        eyebrow={t("settingsPage.eyebrow")}
        title={t.rich("settingsPage.title", {}, { s: (c) => <Script>{c}</Script> })}
        sub={t("settingsPage.sub")}
      />

      <AgentStatus
        needs={[]}
        hereNeeds
        working={consents.autoSubmit === false ? (sim ? t("settingsPage.statusAutoOffSim") : t("settingsPage.statusAutoOff")) : t("settingsPage.statusWorking")}
        className="-mt-3 mb-8"
      />

      <div className="flex flex-col gap-12">
        <section aria-labelledby="consents-h">
          <SectionTitle eyebrow={t("settingsPage.consents.eyebrow")} title={<span id="consents-h">{t("settingsPage.consents.title")}</span>} sub={consents.at ? t("settingsPage.consents.lastChange", { date: t.date(consents.at, "dateTime") }) : undefined} />
          <Card>
            <ActionForm action={updateConsents} className="flex flex-col gap-4">
              <ul className="flex flex-col divide-y divide-line">
                {CONSENTS.map((key) => (
                  <li key={key} id={key === "autoSubmit" ? "autosubmit" : undefined} className="scroll-mt-24 py-4 first:pt-0">
                    <label className="flex cursor-pointer items-start justify-between gap-4 rounded-xl has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-4 has-[:focus-visible]:outline-green">
                      <span className="flex min-w-0 flex-col gap-1">
                        <span className="text-[15px] text-head">{t(`settingsPage.consents.${key}Title`)}</span>
                        <span className="max-w-2xl break-words text-[13.5px] text-ink-3">{sim && HAS_SIM_TEXT.has(key) ? t(`settingsPage.consents.${key as "autoSubmit" | "emailScan"}TextSim`) : t(`settingsPage.consents.${key}Text`)}</span>
                      </span>
                      <input type="checkbox" role="switch" name={key} defaultChecked={Boolean(consents[key])} className="peer sr-only" />
                      <span className="relative mt-0.5 h-6 w-11 shrink-0 rounded-full bg-head/15 transition-colors peer-checked:bg-green after:absolute after:left-0.5 after:top-0.5 after:size-5 after:rounded-full after:bg-white after:shadow after:transition-transform peer-checked:after:translate-x-5" aria-hidden />
                    </label>
                    {key === "autoSubmit" && (
                      <p className="mt-2 max-w-2xl text-[13px] text-ink-3">
                        {t.rich("settingsPage.consents.autoSubmitNote", {}, {
                          a: (c) => <Link href="/app/agent#auto-apply" className="inline-flex min-h-10 items-center rounded text-teal underline decoration-line underline-offset-4 hover:text-head focus-visible:outline-2 focus-visible:outline-green sm:min-h-0">{c}</Link>,
                        })}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
              <div className="flex flex-wrap items-center gap-3">
                <FormSubmit pendingText={t("settingsPage.consents.saving")}>{t("settingsPage.consents.save")}</FormSubmit>
                <span className="text-[12.5px] text-ink-3">{t("settingsPage.consents.logged")}</span>
              </div>
            </ActionForm>
          </Card>
        </section>

        <section aria-labelledby="notify-h" id="notifications" className="scroll-mt-24">
          <SectionTitle eyebrow={t("settingsPage.notify.eyebrow")} title={<span id="notify-h">{t("settingsPage.notify.title")}</span>} sub={t("settingsPage.notify.sub")} />
          <div className="grid gap-6 lg:grid-cols-2">
            <I18nScope ns={["telegramCard"]}>
              <TelegramCard />
            </I18nScope>
            <I18nScope ns={["pushCard"]}>
              <PushCard />
            </I18nScope>
          </div>
        </section>

        <section aria-labelledby="data-h" className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-3"><SectionTitle eyebrow={t("settingsPage.data.eyebrow")} title={<span id="data-h">{t("settingsPage.data.title")}</span>} /></div>
          <Card className="flex flex-col gap-3">
            <Download className="size-5 text-teal" strokeWidth={1.7} aria-hidden />
            <h3 className="h-serif text-[19px]">{t("settingsPage.data.exportTitle")}</h3>
            <p className="text-[13.5px] text-ink-3">{t("settingsPage.data.exportText")}</p>
            <a href="/api/export" download className="mt-auto inline-flex h-11 w-fit items-center justify-center gap-2 rounded-full bg-cta px-5 text-[14.5px] font-medium text-[#fcfcfc] shadow-(--shadow-cta) transition-all hover:bg-[#2f2c2c] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-green active:scale-[.98]">
              <Download className="size-4" strokeWidth={1.7} aria-hidden />{t("settingsPage.data.exportButton")}
            </a>
          </Card>
          <Card className="flex flex-col gap-3">
            <Timer className="size-5 text-teal" strokeWidth={1.7} aria-hidden />
            <h3 className="h-serif text-[19px]">{t("settingsPage.data.retentionTitle")}</h3>
            <ul className="flex flex-col gap-1.5 break-words text-[13.5px] text-ink-3">
              <li>{t("settingsPage.data.retention1")}</li>
              <li>{t("settingsPage.data.retention2")}</li>
              <li>{t("settingsPage.data.retention3")}</li>
              <li>{t("settingsPage.data.retention4")}</li>
              {hhEnabled() && <li>{t("settingsPage.data.retentionHh")}</li>}
              <li>{t("settingsPage.data.retention5")}</li>
            </ul>
          </Card>
          <Card className="flex flex-col gap-3">
            <ShieldCheck className="size-5 text-teal" strokeWidth={1.7} aria-hidden />
            <h3 className="h-serif text-[19px]">{t("settingsPage.data.securityTitle")}</h3>
            <ul className="flex flex-col gap-1.5 break-words text-[13.5px] text-ink-3">
              <li>{t("settingsPage.data.security1")}</li>
              <li>{t("settingsPage.data.security2")}</li>
              <li>{t("settingsPage.data.security3")}</li>
              <li>{t("settingsPage.data.security4")}</li>
            </ul>
          </Card>
        </section>

        <section aria-labelledby="audit-h" id="audit" className="scroll-mt-24">
          <SectionTitle eyebrow={t("settingsPage.audit.eyebrow")} title={<span id="audit-h">{t("settingsPage.audit.title")}</span>} sub={t("settingsPage.audit.sub", { n: LIMIT })} />
          <Card className="!p-0">
            {slice.length === 0 ? (
              <p className="px-6 py-10 text-center text-[14px] text-ink-3">{t("settingsPage.audit.empty")}</p>
            ) : (
              <ol className="flex flex-col divide-y divide-line">
                {slice.map((e) => (
                  <li key={e.id} className="grid gap-x-4 gap-y-1 px-5 py-3.5 sm:grid-cols-[150px_1fr] sm:items-center sm:px-6">
                    <time dateTime={e.createdAt.toISOString()} className="num text-[12.5px] text-ink-3">{t.date(e.createdAt, "dateTime")}</time>
                    <span lang="ru" className="min-w-0 break-words text-[14px] text-ink-2">{e.message}</span>
                  </li>
                ))}
              </ol>
            )}
            {pages > 1 && (
              <nav aria-label={t("settingsPage.audit.pagesAria")} className="flex items-center justify-between gap-3 border-t border-line px-5 py-3 sm:px-6">
                <PageLink page={page - 1} disabled={page <= 1} label={t("settingsPage.audit.newerAria")}><ChevronLeft className="size-4" strokeWidth={1.7} aria-hidden />{t("settingsPage.audit.newer")}</PageLink>
                <span className="font-mono text-[11px] uppercase tracking-[.06em] text-ink-3">{t("settingsPage.audit.page", { page, pages })}</span>
                <PageLink page={page + 1} disabled={page >= pages} label={t("settingsPage.audit.olderAria")}>{t("settingsPage.audit.older")}<ChevronRight className="size-4" strokeWidth={1.7} aria-hidden /></PageLink>
              </nav>
            )}
          </Card>
        </section>

        <section aria-labelledby="danger-h">
          <SectionTitle eyebrow={t("settingsPage.danger.eyebrow")} title={<span id="danger-h">{t("settingsPage.danger.title")}</span>} />
          <Card className="border-rose/20">
            <div className="mb-4 flex items-center gap-2">
              <KeyRound className="size-4 text-rose" strokeWidth={1.7} aria-hidden />
              <Label className="!text-rose">{t("settingsPage.danger.irreversible")}</Label>
            </div>
            <I18nScope ns={["settingsPage"]}>
              <DeleteAccount email={user.email} />
            </I18nScope>
          </Card>
        </section>
      </div>
      <p className="mt-10 flex items-center gap-2 text-[12.5px] text-ink-3"><History className="size-3.5" strokeWidth={1.7} aria-hidden />{t("settingsPage.created", { date: t.date(user.createdAt, "dayMonthYear") })}</p>
    </>
  );
}

function PageLink({ page, disabled, label, children }: { page: number; disabled: boolean; label: string; children: React.ReactNode }) {
  const cls = "inline-flex h-10 items-center gap-1 rounded-full px-3 text-[13px] transition-colors";
  if (disabled) return <span aria-disabled className={cx(cls, "text-ink-4")}>{children}</span>;
  return <Link href={`/app/settings?page=${page}#audit`} scroll={false} aria-label={label} className={cx(cls, "text-head hover:bg-white/60 focus-visible:outline-2 focus-visible:outline-green")}>{children}</Link>;
}
