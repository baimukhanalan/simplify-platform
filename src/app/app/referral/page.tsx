import type { Metadata } from "next";
import { headers } from "next/headers";
import { CalendarPlus, Link2, Wallet } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { Card, Chip, Label, PageHeader, Script, cx, type Tone } from "@/components/ui";
import { REFERRAL_DISCOUNT_PCT, REFERRAL_REWARD_DAYS, appOrigin, referralOverview, type ReferralOverview } from "@/lib/referral";
import { count, shortDate } from "../../_components/ru";
import { ShareInvite } from "./_components/share-invite";

export const metadata: Metadata = { title: "Пригласи друга" };

const DAYS = ["день", "дня", "дней"] as const;

const STATUS: Record<ReferralOverview["friends"][number]["status"], { label: string; tone: Tone }> = {
  signed_up: { label: "Ждём оплату", tone: "neutral" },
  paid: { label: `+${REFERRAL_REWARD_DAYS} дней к следующей`, tone: "teal" },
  rewarded: { label: `+${REFERRAL_REWARD_DAYS} дней`, tone: "green" },
};

const STEPS = [
  { icon: Link2, title: "Отправь ссылку", text: "Поделись личной ссылкой или кодом — в мессенджере, в сторис, где удобно." },
  { icon: Wallet, title: `Другу — −${REFERRAL_DISCOUNT_PCT}%`, text: `Друг регистрируется по ссылке и получает скидку ${REFERRAL_DISCOUNT_PCT}% на первую кампанию.` },
  { icon: CalendarPlus, title: `Тебе — +${REFERRAL_REWARD_DAYS} дней`, text: `Когда друг оплатит, к твоей кампании добавится ${REFERRAL_REWARD_DAYS} дней. Нет активной — дни дождутся следующей.` },
];

export default async function ReferralPage() {
  const user = await requireUser();
  const [data, h] = await Promise.all([referralOverview(user.id), headers()]);
  const url = `${appOrigin(h.get("host"))}/r/${data.code}`;
  const text = `Simplify — AI-агент, который ищет работу за тебя: подбирает вакансии, адаптирует CV и подаёт заявки. По моей ссылке −${REFERRAL_DISCOUNT_PCT}% на первую кампанию:`;
  const { invited, paid, daysEarned, daysPending } = data.stats;

  return (
    <>
      <PageHeader
        eyebrow="Приведи друга"
        title={<>Пригласи <Script>друга</Script></>}
        sub={`Другу — −${REFERRAL_DISCOUNT_PCT}% на первую Career Campaign. Тебе — +${REFERRAL_REWARD_DAYS} дней к своей, когда друг оплатит.`}
      />

      <div className="flex flex-col gap-6">
        <Card strong className="flex animate-rise flex-col gap-5">
          <Label>Твоя ссылка</Label>
          <ShareInvite url={url} code={data.code} text={text} />
        </Card>

        <Card className="animate-rise" style={{ animationDelay: "80ms" }}>
          <dl className="grid grid-cols-3 gap-4">
            {[
              { l: "Приглашено", v: String(invited) },
              { l: "Оплатили", v: String(paid) },
              { l: "Дней получено", v: daysEarned ? `+${daysEarned}` : "0", green: daysEarned > 0 },
            ].map((x) => (
              <div key={x.l} className="flex flex-col-reverse justify-end gap-1.5">
                <dt className="label !text-[11px]">{x.l}</dt>
                <dd className={cx("num text-[32px] leading-none", x.green ? "text-green" : "text-head")}>{x.v}</dd>
              </div>
            ))}
          </dl>
          {daysPending > 0 && <p className="mt-4 border-t border-line pt-3 text-[12.5px] text-ink-3">Ещё {count(daysPending, DAYS)} зачислено — добавятся, когда начнётся твоя следующая кампания.</p>}
        </Card>
      </div>

      <section aria-labelledby="how-h" className="mt-10">
        <Label className="mb-4"><span id="how-h">Как это работает</span></Label>
        <ol className="grid gap-4 md:grid-cols-3">
          {STEPS.map((s, i) => (
            <li key={s.title} className="glass flex animate-rise flex-col gap-3 p-5" style={{ animationDelay: `${120 + i * 60}ms` }}>
              <div className="flex items-center gap-3">
                <span className="num grid size-8 place-items-center rounded-full bg-green-soft text-[13px] text-green">{i + 1}</span>
                <s.icon className="size-4 text-teal" strokeWidth={1.7} aria-hidden />
              </div>
              <div className="text-[15px] font-medium text-head">{s.title}</div>
              <p className="text-[13.5px] leading-relaxed text-ink-2">{s.text}</p>
            </li>
          ))}
        </ol>
        <p className="mt-4 text-[12.5px] text-ink-3">
          Одна награда за каждого приглашённого друга. Скидка действует только на первую кампанию друга; пригласить самого себя нельзя.
        </p>
      </section>

      <section aria-labelledby="friends-h" className="mt-10">
        <Card>
          <div className="mb-4 flex items-center justify-between gap-3">
            <Label><span id="friends-h">Приглашённые друзья</span></Label>
            {invited > 0 && <span className="text-[12.5px] text-ink-3">{count(invited, ["друг", "друга", "друзей"])}</span>}
          </div>
          {data.friends.length === 0 ? (
            <p className="text-[14px] text-ink-3">Пока никого. Отправь ссылку — друзья появятся здесь сразу после регистрации.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-line">
              {data.friends.map((f) => (
                <li key={f.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0">
                  <div className="min-w-0">
                    <div className="text-[14px] text-head">{f.name}</div>
                    <div className="truncate text-[12.5px] text-ink-3">
                      {f.email} · {f.status === "rewarded" && f.rewardedAt ? `оплата ${shortDate(f.rewardedAt)}` : `с ${shortDate(f.createdAt)}`}
                    </div>
                  </div>
                  <Chip tone={STATUS[f.status].tone}>{STATUS[f.status].label}</Chip>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>
    </>
  );
}
