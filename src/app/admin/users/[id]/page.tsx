import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Bell, Check, Minus } from "lucide-react";
import { requireAdmin } from "@/lib/auth";
import { Card, Chip, Label, PageHeader, cx } from "@/components/ui";
import { userDetail } from "@/lib/admin/queries";
import { FUNNEL_STEPS, bonusBreakdown, campaignDay, stageLabel } from "@/lib/admin/metrics";
import { GUARANTEE_DAYS } from "@/lib/engine/guarantee";
import { PLANS, SENIORITY_LABEL, fmtKzt, fmtMoney } from "@/lib/engine/taxonomy";
import { j } from "@/lib/db";
import { fmtNum, fmtYearsRu } from "@/lib/ru";
import { EmailReveal } from "../../_components/email-reveal";
import { CAMPAIGN_STATUS, PAYMENT_STATUS, PLAN_LABEL, PROVIDER_LABEL, REFUND_REASON, ago, fmtDate, fmtDateTime, clock } from "../../_components/fmt";

export const metadata = { title: "Пользователь · Admin" };

const REF_STATUS: Record<string, string> = { signed_up: "регистрация", paid: "оплата", rewarded: "бонус начислен" };

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[130px_1fr] gap-3 py-2 text-[13.5px]">
      <dt className="text-ink-3">{k}</dt>
      <dd className="min-w-0 break-words text-head">{children}</dd>
    </div>
  );
}

function Flag({ on, children }: { on: boolean; children: React.ReactNode }) {
  return (
    <li className="flex items-center gap-2 text-[13.5px]">
      <span className={cx("grid size-5 place-items-center rounded-full", on ? "bg-green-soft text-green" : "bg-head/8 text-ink-4")}>{on ? <Check className="size-3" strokeWidth={2.2} /> : <Minus className="size-3" strokeWidth={2.2} />}</span>
      <span className={on ? "text-head" : "text-ink-3"}>{children}</span>
    </li>
  );
}

export default async function UserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) notFound();
  const d = await userDetail(id);
  if (!d) notFound();
  const { user, campaigns, payments, events, channels, referral, steps } = d;
  const now = clock();
  const skills = j<string[]>(user.profile?.skills, []);
  const countries = j<string[]>(user.goal?.countries, []);

  return (
    <>
      <Link href="/admin/users" className="mb-4 inline-flex h-9 items-center gap-1.5 rounded-full pr-3 text-[13px] text-teal hover:underline focus-visible:outline-2 focus-visible:outline-green"><ArrowLeft className="size-3.5" strokeWidth={1.7} />Все пользователи</Link>
      <PageHeader
        eyebrow={`Пользователь · с ${fmtDate(user.createdAt)}`}
        title={user.name || "Без имени"}
        sub={<EmailReveal userId={user.id} masked={user.masked} />}
        actions={<><Chip tone={d.stage === "hired" ? "green" : "teal"}>Этап: {stageLabel(d.stage)}</Chip>{user.role !== "user" && <Chip tone="dark">{user.role}</Chip>}</>}
      />

      <div className="flex flex-col gap-4">
        {/* Funnel path */}
        <Card>
          <Label className="mb-3">Путь по воронке</Label>
          <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
            {FUNNEL_STEPS.map((s, i) => {
              const t = steps[s.key];
              const reached = FUNNEL_STEPS.findIndex((x) => x.key === d.stage) >= i;
              return (
                <li key={s.key} className={cx("rounded-2xl border px-3 py-2.5", reached ? "border-green/20 bg-green-soft" : "border-line bg-white/40")}>
                  <div className={cx("text-[12.5px] font-medium", reached ? "text-green" : "text-ink-4")}>{s.short}</div>
                  <div className="num text-[11.5px] text-ink-3">{t ? fmtDate(new Date(t)) : reached ? "✓" : "—"}</div>
                </li>
              );
            })}
          </ol>
        </Card>

        <div className="grid gap-4 lg:grid-cols-3">
          <Card>
            <h2 className="h-serif mb-2 text-[20px]">Профиль</h2>
            {user.profile || user.goal ? (
              <dl className="divide-y divide-line">
                <Row k="Цель">{user.goal?.primaryRole || "—"}{user.goal ? ` · ${SENIORITY_LABEL[user.goal.seniority] ?? user.goal.seniority}` : ""}</Row>
                <Row k="Рынки">{countries.length ? countries.join(", ") : "—"}</Row>
                <Row k="Зарплата от">{user.goal?.minSalary ? fmtMoney(user.goal.minSalary, user.goal.currency) : "—"}</Row>
                <Row k="Заголовок">{user.profile?.headline || "—"}</Row>
                <Row k="Город">{[user.profile?.city, user.profile?.country].filter(Boolean).join(", ") || "—"}</Row>
                <Row k="Опыт">{user.profile?.yearsExperience ? fmtYearsRu(user.profile.yearsExperience) : "—"} · English {user.profile?.englishLevel ?? "—"}</Row>
                <Row k="Навыки">{skills.length ? `${skills.slice(0, 8).join(", ")}${skills.length > 8 ? ` +${skills.length - 8}` : ""}` : "—"}</Row>
                <Row k="CV">{user.profile?.cvFileName ? "загружено" : "нет"}</Row>
                <Row k="Режим">{user.careerMode === "passive" ? "пассивный" : "активный"} · {user.locale}</Row>
              </dl>
            ) : <p className="text-[13.5px] text-ink-3">Онбординг не начат.</p>}
          </Card>

          <Card>
            <h2 className="h-serif mb-3 flex items-center gap-2 text-[20px]"><Bell className="size-4 text-teal" strokeWidth={1.7} />Уведомления</h2>
            <ul className="flex flex-col gap-2.5">
              <Flag on={channels.telegram}>Telegram {channels.telegram ? `привязан ${fmtDate(channels.telegramLinkedAt)}` : "не привязан"}</Flag>
              <Flag on={channels.push > 0}>Push: {channels.push > 0 ? `${channels.push} устр.` : "нет подписок"}</Flag>
              <Flag on={channels.inboxAlias}>Адрес для пересылки писем {channels.inboxAlias ? "выдан" : "не выдан"}</Flag>
              <Flag on={channels.integrations.includes("hh")}>hh.kz {channels.integrations.includes("hh") ? "подключён" : "не подключён"}</Flag>
              <Flag on={channels.integrations.includes("extension")}>Расширение {channels.integrations.includes("extension") ? "подключено" : "не подключено"}</Flag>
            </ul>
            <div className="mt-4 grid grid-cols-2 gap-3 border-t border-line pt-4 text-[12.5px] text-ink-3">
              <span>Всего: <b className="num font-normal text-head">{channels.notifications}</b></span>
              <span>Прочитано: <b className="num font-normal text-head">{channels.read}</b></span>
              <span>В Telegram: <b className="num font-normal text-head">{channels.viaTelegram}</b></span>
              <span>Push: <b className="num font-normal text-head">{channels.viaPush}</b></span>
            </div>
            {Object.keys(channels.prefs).length > 0 && (
              <p className="mt-3 text-[12px] text-ink-4">Настройки: {Object.entries(channels.prefs).map(([k, v]) => `${k} ${v ? "вкл" : "выкл"}`).join(" · ")}</p>
            )}
          </Card>

          <Card>
            <h2 className="h-serif mb-2 text-[20px]">Рефералы</h2>
            <dl className="divide-y divide-line">
              <Row k="Свой код">{referral.code ? <span className="font-mono text-[12.5px]">{referral.code}</span> : "—"}</Row>
              <Row k="Приглашение от">
                {referral.referredBy ? (
                  <><Link href={`/admin/users/${referral.referredBy.referrer.id}`} className="text-teal hover:underline">{referral.referredBy.referrer.name}</Link> · {REF_STATUS[referral.referredBy.status] ?? referral.referredBy.status}{referral.referredBy.discountKzt ? ` · скидка ${fmtKzt(referral.referredBy.discountKzt)}` : ""}</>
                ) : user.referredByCode ? <span className="font-mono text-[12.5px]">{user.referredByCode}</span> : "—"}
              </Row>
              <Row k="Приглашено">{fmtNum(referral.madeCount, 0)}</Row>
            </dl>
            {referral.made.length > 0 && (
              <ul className="mt-2 flex flex-col gap-1.5">
                {referral.made.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-2 text-[13px]">
                    <Link href={`/admin/users/${r.referred.id}`} className="truncate text-teal hover:underline">{r.referred.name}</Link>
                    <span className="shrink-0 text-[12px] text-ink-3">{REF_STATUS[r.status] ?? r.status}{r.rewardDays ? ` · +${r.rewardDays} дн.` : ""}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <Card className="!p-0">
          <h2 className="h-serif px-5 pt-5 text-[20px] sm:px-6">Кампании</h2>
          {campaigns.length === 0 ? <p className="px-6 py-5 text-[13.5px] text-ink-3">Кампаний нет.</p> : (
            <div className="scroll-thin mt-3 overflow-x-auto">
              <table className="w-full min-w-[820px] text-left text-[13.5px]">
                <thead><tr className="border-b border-line">{["Создана", "План", "Статус", "День", "Readiness", "Заявки", "С интервью", "Последний цикл", "Гарантия"].map((c) => <th key={c} scope="col" className="label px-4 py-2.5 !text-[11px] font-normal first:pl-6 last:pr-6">{c}</th>)}</tr></thead>
                <tbody className="divide-y divide-line">
                  {campaigns.map((c) => {
                    const day = campaignDay(c, now, PLANS[c.plan as keyof typeof PLANS]?.days);
                    return (
                      <tr key={c.id}>
                        <td className="whitespace-nowrap px-4 py-2.5 pl-6 text-ink-2">{fmtDate(c.createdAt)}</td>
                        <td className="px-4 py-2.5"><Chip tone={c.plan === "international" ? "dark" : "teal"}>{PLAN_LABEL[c.plan] ?? c.plan}</Chip></td>
                        <td className="px-4 py-2.5"><Chip tone={c.status === "active" ? "green" : c.status === "hired" ? "green" : c.status === "paused" ? "amber" : "neutral"}>{CAMPAIGN_STATUS[c.status] ?? c.status}</Chip></td>
                        <td className="num px-4 py-2.5">{day && c.status !== "draft" ? <>{day.day}<span className="text-ink-4">/{day.total}</span></> : "—"}</td>
                        <td className="num px-4 py-2.5">{c.readiness}</td>
                        <td className="num px-4 py-2.5">{c.applications}</td>
                        <td className="num px-4 py-2.5">{c.withInterview}</td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-[12.5px] text-ink-3">{ago(c.lastRunAt, now)}</td>
                        <td className="px-4 py-2.5 pr-6 text-[12.5px] text-ink-3"><BonusDays c={c} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
          <Card className="!p-0">
            <h2 className="h-serif px-5 pt-5 text-[20px] sm:px-6">Платежи</h2>
            {payments.length === 0 ? <p className="px-6 py-5 text-[13.5px] text-ink-3">Платежей нет.</p> : (
              <ul className="mt-2 divide-y divide-line">
                {payments.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3 sm:px-6">
                    <span className="num text-[14px] text-head">{fmtKzt(p.amount)}</span>
                    <Chip tone={p.status === "paid" ? "green" : p.status === "pending" ? "amber" : "neutral"}>{PAYMENT_STATUS[p.status] ?? p.status}</Chip>
                    {p.refund.refundDue && <Chip tone="rose">возврат{p.refund.refunds[0] ? `: ${REFUND_REASON[p.refund.refunds[0].reason] ?? p.refund.refunds[0].reason}` : ""}</Chip>}
                    <span className="flex-1" />
                    <span className="text-[12px] text-ink-3">{PLAN_LABEL[p.plan] ?? p.plan} · {PROVIDER_LABEL[p.provider] ?? p.provider} · {fmtDateTime(p.paidAt ?? p.createdAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card className="!p-0">
            <h2 className="h-serif px-5 pt-5 text-[20px] sm:px-6">Последние события</h2>
            {events.length === 0 ? <p className="px-6 py-5 text-[13.5px] text-ink-3">Событий нет.</p> : (
              <ul className="scroll-thin mt-2 max-h-[460px] divide-y divide-line overflow-auto">
                {events.map((e) => (
                  <li key={e.id} className="flex flex-col gap-0.5 px-5 py-2.5 sm:px-6">
                    <span className="flex items-center gap-2 text-[11.5px] text-ink-4"><span className="font-mono">{e.type}</span>· {fmtDateTime(e.createdAt)}</span>
                    <span className="text-[13px] text-ink-2">{e.message}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}

/** «+45 дн.» with where the days came from: «15 за друзей · 30 по гарантии». */
function BonusDays({ c }: { c: { bonusDays: number; guaranteeStatus: string } }) {
  const b = bonusBreakdown(c, GUARANTEE_DAYS);
  if (!b.total) return <>—</>;
  const parts = [b.referral ? `${b.referral} за друзей` : "", b.guarantee ? `${b.guarantee} по гарантии` : ""].filter(Boolean);
  return (
    <span className="flex flex-col whitespace-nowrap">
      <span className="num text-head">+{b.total} дн.</span>
      {parts.length > 0 && <span className="text-[11.5px] text-ink-3">{parts.join(" · ")}</span>}
    </span>
  );
}
