import Link from "next/link";
import { Download, Mail, Phone, Search, Send, X } from "lucide-react";
import { requireAdmin } from "@/lib/auth";
import { Card, Chip, PageHeader, Script, Stat } from "@/components/ui";
import {
  ENGLISH_LEVELS, LEADS_PAGE, LEAD_STATUSES, LEAD_STATUS_LABEL, LEVEL_LABEL, SPECIALIZATIONS, SPEC_LABEL,
  leadKpis, leadQuery, leadsPage, parseLeadFilters, type EnglishLevel, type Specialization,
} from "@/lib/leads";
import { fmtNum } from "@/lib/ru";
import { Pager } from "../_components/pager";
import { fmtDateTime } from "../_components/fmt";
import { LeadNote, LeadStatus } from "./_components/lead-edit";

export const metadata = { title: "Заявки · Admin" };

const STATUS_OPTIONS = LEAD_STATUSES.map((s) => ({ value: s, label: LEAD_STATUS_LABEL[s] }));
const LOCALE_LABEL: Record<string, string> = { ru: "RU", kk: "ҚАЗ", en: "EN" };
// mailto: opens the admin's mail app — the address never goes into a URL of this site (cf. the users-page guard in tests/admin.test.ts).
const mailto = (email: string) => `mailto:${encodeURIComponent(email).replace(/%40/g, "@")}`;
const selectCls = "field cursor-pointer !py-2.5 !text-[14px]";

export default async function LeadsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdmin();
  const f = parseLeadFilters(await searchParams);
  const [{ total, rows }, k] = await Promise.all([leadsPage(f), leadKpis()]);
  const pages = Math.max(1, Math.ceil(total / LEADS_PAGE));
  const filtered = Boolean(f.q || f.status || f.level || f.spec || f.from || f.to);
  const maxSpec = Math.max(1, ...k.bySpec.map((s) => s.n));
  const maxLevel = Math.max(1, ...k.byLevel.map((s) => s.n));

  return (
    <>
      <PageHeader
        eyebrow="Admin · заявки"
        title={<>Заявки на <Script>кампанию</Script></>}
        sub="Форма /apply с лендинга. Свяжись в течение 24 часов и отметь статус — новые считаются в бейдже меню."
        actions={
          <Link href={`/admin/leads/export${leadQuery(f)}`} prefetch={false} className="inline-flex h-10 items-center gap-2 rounded-full bg-cta px-4 text-[13px] font-medium text-white shadow-(--shadow-cta) hover:bg-[#2f2c2c] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-green">
            <Download className="size-4" strokeWidth={1.7} aria-hidden />Экспорт CSV{filtered ? " · по фильтру" : ""}
          </Link>
        }
      />

      <div className="flex flex-col gap-6">
        <section aria-labelledby="lead-kpi" className="flex flex-col gap-4">
          <h2 id="lead-kpi" className="sr-only">Ключевые цифры</h2>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Card><Stat label="Всего заявок" value={fmtNum(k.total, 0)} /></Card>
            <Card strong><Stat label="Ждут ответа" tone={k.fresh ? "green" : undefined} value={fmtNum(k.fresh, 0)} hint="статус «Новая»" /></Card>
            <Card><Stat label="Сегодня" value={fmtNum(k.today, 0)} hint="с 00:00 по Алматы" /></Card>
            <Card><Stat label="На этой неделе" value={fmtNum(k.week, 0)} hint="с понедельника" /></Card>
          </div>
          {k.total > 0 && (
            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <h3 className="label mb-3">По специализации</h3>
                <ul className="flex flex-col gap-2">
                  {k.bySpec.slice(0, 6).map((s) => (
                    <li key={s.key} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 text-[13px]">
                      <Link href={`/admin/leads${leadQuery({ ...f, spec: s.key as Specialization })}`} className="truncate text-head hover:underline focus-visible:outline-2 focus-visible:outline-green">{SPEC_LABEL[s.key as Specialization] ?? s.key}</Link>
                      <span className="num text-ink-3">{s.n}</span>
                      <span className="col-span-2 h-1.5 overflow-hidden rounded-full bg-head/10"><span className="block h-full rounded-full bg-teal" style={{ width: `${(s.n / maxSpec) * 100}%` }} /></span>
                    </li>
                  ))}
                </ul>
              </Card>
              <Card>
                <h3 className="label mb-3">Уровень английского</h3>
                <div className="flex h-[132px] items-end gap-2" role="list">
                  {k.byLevel.map((l) => (
                    <div key={l.key} role="listitem" className="flex flex-1 flex-col items-center gap-1.5" aria-label={`${LEVEL_LABEL[l.key]}: ${l.n}`}>
                      <span className="num text-[12px] text-ink-3" aria-hidden>{l.n}</span>
                      <span className="w-full max-w-10 rounded-t-lg bg-green/80" style={{ height: `${Math.max(3, (l.n / maxLevel) * 84)}px` }} aria-hidden />
                      <span className="num text-[11.5px] text-head" aria-hidden>{LEVEL_LABEL[l.key]}</span>
                    </div>
                  ))}
                </div>
              </Card>
            </div>
          )}
        </section>

        <Card className="!p-0">
          <form method="get" action="/admin/leads" role="search" className="grid gap-3 border-b border-line p-5 sm:grid-cols-2 sm:px-6 lg:grid-cols-[minmax(0,1.6fr)_repeat(3,minmax(0,1fr))]">
            <label className="relative sm:col-span-2 lg:col-span-1">
              <span className="sr-only">Поиск по имени, e-mail, телефону или Telegram</span>
              <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-ink-4" strokeWidth={1.7} aria-hidden />
              <input name="q" defaultValue={f.q} maxLength={100} placeholder="Имя, e-mail, телефон, Telegram" className="field !py-2.5 !pl-10 !text-[14px]" autoComplete="off" />
            </label>
            <label>
              <span className="sr-only">Статус</span>
              <select name="status" defaultValue={f.status} className={selectCls}>
                <option value="">Все статусы</option>
                {LEAD_STATUSES.map((s) => <option key={s} value={s}>{LEAD_STATUS_LABEL[s]}</option>)}
              </select>
            </label>
            <label>
              <span className="sr-only">Уровень английского</span>
              <select name="level" defaultValue={f.level} className={selectCls}>
                <option value="">Любой английский</option>
                {ENGLISH_LEVELS.map((l) => <option key={l} value={l}>{LEVEL_LABEL[l]}</option>)}
              </select>
            </label>
            <label>
              <span className="sr-only">Специализация</span>
              <select name="spec" defaultValue={f.spec} className={selectCls}>
                <option value="">Все специализации</option>
                {SPECIALIZATIONS.map((s) => <option key={s} value={s}>{SPEC_LABEL[s]}</option>)}
              </select>
            </label>
            <div className="flex flex-wrap items-end gap-3 sm:col-span-2 lg:col-span-4">
              <label className="flex flex-col gap-1">
                <span className="label !text-[10.5px]">С даты</span>
                <input type="date" name="from" defaultValue={f.from} className="field !w-[170px] !py-2 !text-[14px]" />
              </label>
              <label className="flex flex-col gap-1">
                <span className="label !text-[10.5px]">По дату</span>
                <input type="date" name="to" defaultValue={f.to} className="field !w-[170px] !py-2 !text-[14px]" />
              </label>
              <button className="inline-flex h-10 items-center rounded-full bg-cta px-5 text-[13px] font-medium text-white hover:bg-[#2f2c2c] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-green">Применить</button>
              {filtered && <Link href="/admin/leads" className="inline-flex h-10 items-center gap-1 rounded-full px-3 text-[13px] text-teal hover:bg-white/70 focus-visible:outline-2 focus-visible:outline-green"><X className="size-3.5" strokeWidth={1.7} aria-hidden />Сбросить</Link>}
              <span className="num ml-auto self-center text-[13px] text-ink-3">{fmtNum(total, 0)} найдено</span>
            </div>
          </form>

          {rows.length === 0 ? (
            <p className="px-6 py-10 text-[14px] text-ink-3">{filtered ? "По этим фильтрам заявок нет." : "Заявок пока нет — они появятся здесь, как только кто-то отправит форму /apply."}</p>
          ) : (
            <ul className="divide-y divide-line">
              {rows.map((l) => (
                <li key={l.id} className="grid gap-4 px-5 py-4 sm:px-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1.2fr)] lg:gap-6">
                  <div className="flex min-w-0 flex-col gap-1">
                    <span className="break-words text-[15px] font-medium text-head">{l.fullName}</span>
                    <span className="text-[12.5px] text-ink-3"><time dateTime={l.createdAt.toISOString()}>{fmtDateTime(l.createdAt)}</time>{l.updatedAt.getTime() - l.createdAt.getTime() > 60_000 && <> · обновлена {fmtDateTime(l.updatedAt)}</>}</span>
                    <span className="flex flex-wrap items-center gap-1.5 pt-0.5">
                      <Chip tone={l.source === "landing" ? "teal" : "neutral"} className="!px-1.5 !py-0.5 !text-[9.5px]">{l.source === "landing" ? "лендинг" : "напрямую"}</Chip>
                      {l.ref && <Chip className="!px-1.5 !py-0.5 !text-[9.5px]">ref: {l.ref}</Chip>}
                      <Chip className="!px-1.5 !py-0.5 !text-[9.5px]">{LOCALE_LABEL[l.locale] ?? l.locale}</Chip>
                    </span>
                  </div>
                  <div className="flex min-w-0 flex-col gap-1 text-[13.5px]">
                    <a href={mailto(l.email)} className="inline-flex min-w-0 items-center gap-2 text-head hover:underline focus-visible:outline-2 focus-visible:outline-green"><Mail className="size-3.5 shrink-0 text-teal" strokeWidth={1.7} aria-hidden /><span className="truncate">{l.email}</span></a>
                    <a href={`tel:${l.phone}`} className="num inline-flex items-center gap-2 text-head hover:underline focus-visible:outline-2 focus-visible:outline-green"><Phone className="size-3.5 shrink-0 text-teal" strokeWidth={1.7} aria-hidden />{l.phone}</a>
                    {l.telegram && <a href={`https://t.me/${l.telegram}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 text-head hover:underline focus-visible:outline-2 focus-visible:outline-green"><Send className="size-3.5 shrink-0 text-teal" strokeWidth={1.7} aria-hidden />@{l.telegram}</a>}
                  </div>
                  <div className="flex min-w-0 flex-col items-start gap-1.5">
                    <Chip tone="green">EN · {LEVEL_LABEL[l.englishLevel as EnglishLevel] ?? l.englishLevel}</Chip>
                    <span className="text-[13.5px] text-head">{SPEC_LABEL[l.specialization as Specialization] ?? l.specialization}</span>
                    {l.specializationOther && <span className="break-words text-[12.5px] text-ink-3">«{l.specializationOther}»</span>}
                  </div>
                  <div className="flex min-w-0 flex-col gap-2">
                    <LeadStatus id={l.id} status={l.status} options={STATUS_OPTIONS} />
                    <LeadNote id={l.id} note={l.adminNote} />
                  </div>
                </li>
              ))}
            </ul>
          )}
          <Pager page={f.page} pages={pages} href={(p) => `/admin/leads${leadQuery(f, p)}`} />
        </Card>
      </div>
    </>
  );
}
