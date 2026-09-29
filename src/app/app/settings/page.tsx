import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Download, History, KeyRound, ShieldCheck, Timer } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db, j } from "@/lib/db";
import { Card, Label, PageHeader, Script, cx } from "@/components/ui";
import { updateConsents, type Consents } from "@/lib/actions/account";
import { ActionForm, FormSubmit } from "../profile/_components/action-form";
import { SectionTitle } from "../profile/_components/bits";
import { DeleteAccount } from "./_components/delete-account";
import { AgentStatus } from "../../_components/agent-status";

export const metadata: Metadata = { title: "Приватность и данные" };

const CONSENTS = [
  { key: "autoSubmit", title: "Автоподача заявок", text: "Агент подаёт заявки от твоего имени в пределах дневного лимита. Выключено — каждая заявка ждёт твоего подтверждения, а активная кампания переходит в ручной режим." },
  { key: "emailScan", title: "Разбор писем работодателей", text: "Simplify классифицирует ответы работодателей (подтверждение, отказ, тестовое задание, интервью, оффер) и обновляет статусы в Applications. Без согласия статусы обновляются вручную." },
  { key: "copilot", title: "Copilot во время интервью", text: "Подсказки во время интервью — из твоего профиля и STAR-историй. Используй Copilot только там, где это допускают правила интервью." },
  { key: "analytics", title: "Продуктовая аналитика", text: "Обезличенные метрики использования, чтобы улучшать продукт. Simplify не продаёт и не передаёт твои данные рекламным сетям." },
] as const;

const PER_PAGE = 20;
const LIMIT = 100;

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const [user, sp] = await Promise.all([requireUser(), searchParams]);
  const consents = j<Consents>(user.consents, {});
  const events = await db.event.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: LIMIT, select: { id: true, type: true, message: true, createdAt: true } });
  const pages = Math.max(1, Math.ceil(events.length / PER_PAGE));
  const page = Math.min(pages, Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1));
  const slice = events.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  return (
    <>
      <PageHeader
        eyebrow="Приватность и данные"
        title={<>Твои данные — <Script>твои</Script></>}
        sub="Управляй тем, что агент может делать от твоего имени, скачивай всё, что хранит Simplify, и удаляй аккаунт без обращений в поддержку."
      />

      <AgentStatus
        needs={[]}
        hereNeeds
        working={consents.autoSubmit === false ? "Автоподача выключена — агент готовит пакеты, а отправляешь ты." : "Агент действует в рамках этих согласий."}
        className="-mt-3 mb-8"
      />

      <div className="flex flex-col gap-12">
        <section aria-labelledby="consents-h">
          <SectionTitle eyebrow="01 · Согласия" title={<span id="consents-h">Согласия</span>} sub={consents.at ? `Последнее изменение: ${new Date(consents.at).toLocaleString("ru-RU", { timeZone: "Asia/Almaty", dateStyle: "medium", timeStyle: "short" })}` : undefined} />
          <Card>
            <ActionForm action={updateConsents} className="flex flex-col gap-4">
              <ul className="flex flex-col divide-y divide-line">
                {CONSENTS.map((c) => (
                  <li key={c.key} id={c.key === "autoSubmit" ? "autosubmit" : undefined} className="scroll-mt-24 py-4 first:pt-0">
                    <label className="flex cursor-pointer items-start justify-between gap-4 rounded-xl has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-4 has-[:focus-visible]:outline-green">
                      <span className="flex flex-col gap-1">
                        <span className="text-[15px] text-head">{c.title}</span>
                        <span className="max-w-2xl text-[13.5px] text-ink-3">{c.text}</span>
                      </span>
                      <input type="checkbox" role="switch" name={c.key} defaultChecked={Boolean(consents[c.key])} className="peer sr-only" />
                      <span className="relative mt-0.5 h-6 w-11 shrink-0 rounded-full bg-head/15 transition-colors peer-checked:bg-green after:absolute after:left-0.5 after:top-0.5 after:size-5 after:rounded-full after:bg-white after:shadow after:transition-transform peer-checked:after:translate-x-5" aria-hidden />
                    </label>
                    {c.key === "autoSubmit" && (
                      <p className="mt-2 max-w-2xl text-[13px] text-ink-3">
                        Это согласие разрешает агенту отправлять заявки вообще. Какие роли он отправляет сам (порог Match), задаётся в{" "}
                        <Link href="/app/agent#auto-apply" className="inline-flex min-h-10 items-center rounded text-teal underline decoration-line underline-offset-4 hover:text-head focus-visible:outline-2 focus-visible:outline-green sm:min-h-0">Agent → Автоподача</Link>.
                      </p>
                    )}
                  </li>
                ))}
              </ul>
              <div className="flex flex-wrap items-center gap-3">
                <FormSubmit pendingText="Сохраняем…">Сохранить согласия</FormSubmit>
                <span className="text-[12.5px] text-ink-3">Каждое изменение записывается в журнал ниже.</span>
              </div>
            </ActionForm>
          </Card>
        </section>

        <section aria-labelledby="data-h" className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-3"><SectionTitle eyebrow="02 · Данные" title={<span id="data-h">Данные и безопасность</span>} /></div>
          <Card className="flex flex-col gap-3">
            <Download className="size-5 text-teal" strokeWidth={1.7} aria-hidden />
            <h3 className="h-serif text-[19px]">Экспорт данных</h3>
            <p className="text-[13.5px] text-ink-3">Один JSON-файл: профиль, факты, истории, цель, кампании, заявки с пакетами, письма, интервью, офферы, платежи и журнал.</p>
            <a href="/api/export" download className="mt-auto inline-flex h-11 w-fit items-center justify-center gap-2 rounded-full bg-cta px-5 text-[14.5px] font-medium text-[#fcfcfc] shadow-(--shadow-cta) transition-all hover:bg-[#2f2c2c] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-green active:scale-[.98]">
              <Download className="size-4" strokeWidth={1.7} aria-hidden />Скачать JSON
            </a>
          </Card>
          <Card className="flex flex-col gap-3">
            <Timer className="size-5 text-teal" strokeWidth={1.7} aria-hidden />
            <h3 className="h-serif text-[19px]">Хранение</h3>
            <ul className="flex flex-col gap-1.5 text-[13.5px] text-ink-3">
              <li>Профиль и опыт — пока аккаунт активен.</li>
              <li>Заявки и переписка кампании — 12 месяцев после её окончания, затем обезличиваются.</li>
              <li>Транскрипты пробных интервью и сессий Copilot — 90 дней.</li>
              <li>Платёжные записи — по требованию бухгалтерского учёта.</li>
              <li>hh.kz (если подключён): токены доступа — только в зашифрованном виде (AES-256-GCM), id и название выбранного резюме, id и имя аккаунта hh. Пароль от hh мы не видим и не храним. Отключить — «Агент» → hh.kz → «Отключить»: токены удаляются у нас сразу, и мы просим hh отозвать выданный доступ. Отозвать его можно и в настройках самого hh.kz.</li>
              <li>После удаления аккаунта данные стираются сразу, из резервных копий — в течение 30 дней.</li>
            </ul>
          </Card>
          <Card className="flex flex-col gap-3">
            <ShieldCheck className="size-5 text-teal" strokeWidth={1.7} aria-hidden />
            <h3 className="h-serif text-[19px]">Безопасность</h3>
            <ul className="flex flex-col gap-1.5 text-[13.5px] text-ink-3">
              <li>Данные шифруются при хранении и передаются по защищённому соединению (TLS).</li>
              <li>Разграничение доступа: твои данные видишь только ты; операторы видят лишь то, что нужно для поддержки.</li>
              <li>Журнал действий: каждое действие агента и изменение согласий записывается.</li>
              <li>Пароли хранятся только в виде bcrypt-хэша.</li>
            </ul>
          </Card>
        </section>

        <section aria-labelledby="audit-h" id="audit" className="scroll-mt-24">
          <SectionTitle eyebrow="03 · Журнал" title={<span id="audit-h">Журнал действий</span>} sub={`Последние ${LIMIT} событий по твоему аккаунту — действия агента, твои изменения и системные события.`} />
          <Card className="!p-0">
            {slice.length === 0 ? (
              <p className="px-6 py-10 text-center text-[14px] text-ink-3">Событий пока нет.</p>
            ) : (
              <ol className="flex flex-col divide-y divide-line">
                {slice.map((e) => (
                  <li key={e.id} className="grid gap-x-4 gap-y-1 px-5 py-3.5 sm:grid-cols-[150px_1fr] sm:items-center sm:px-6">
                    <time dateTime={e.createdAt.toISOString()} className="num text-[12.5px] text-ink-3">{e.createdAt.toLocaleString("ru-RU", { timeZone: "Asia/Almaty", dateStyle: "short", timeStyle: "short" })}</time>
                    <span className="text-[14px] text-ink-2">{e.message}</span>
                  </li>
                ))}
              </ol>
            )}
            {pages > 1 && (
              <nav aria-label="Страницы журнала" className="flex items-center justify-between gap-3 border-t border-line px-5 py-3 sm:px-6">
                <PageLink page={page - 1} disabled={page <= 1} label="Новее"><ChevronLeft className="size-4" strokeWidth={1.7} aria-hidden />Новее</PageLink>
                <span className="font-mono text-[11px] uppercase tracking-[.06em] text-ink-3">стр. {page} / {pages}</span>
                <PageLink page={page + 1} disabled={page >= pages} label="Старее">Старее<ChevronRight className="size-4" strokeWidth={1.7} aria-hidden /></PageLink>
              </nav>
            )}
          </Card>
        </section>

        <section aria-labelledby="danger-h">
          <SectionTitle eyebrow="04 · Опасная зона" title={<span id="danger-h">Удаление аккаунта</span>} />
          <Card className="border-rose/20">
            <div className="mb-4 flex items-center gap-2">
              <KeyRound className="size-4 text-rose" strokeWidth={1.7} aria-hidden />
              <Label className="!text-rose">Необратимое действие</Label>
            </div>
            <DeleteAccount email={user.email} />
          </Card>
        </section>
      </div>
      <p className="mt-10 flex items-center gap-2 text-[12.5px] text-ink-3"><History className="size-3.5" strokeWidth={1.7} aria-hidden />Аккаунт создан {user.createdAt.toLocaleDateString("ru-RU", { timeZone: "Asia/Almaty" })}</p>
    </>
  );
}

function PageLink({ page, disabled, label, children }: { page: number; disabled: boolean; label: string; children: React.ReactNode }) {
  const cls = "inline-flex h-10 items-center gap-1 rounded-full px-3 text-[13px] transition-colors";
  if (disabled) return <span aria-disabled className={cx(cls, "text-ink-4")}>{children}</span>;
  return <Link href={`/app/settings?page=${page}#audit`} scroll={false} aria-label={`${label} события`} className={cx(cls, "text-head hover:bg-white/60 focus-visible:outline-2 focus-visible:outline-green")}>{children}</Link>;
}
