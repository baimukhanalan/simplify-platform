import type { Metadata } from "next";
import { headers } from "next/headers";
import { CalendarPlus, Link2, Wallet } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { Card, Chip, Label, PageHeader, Script, cx, type Tone } from "@/components/ui";
import { REFERRAL_DISCOUNT_PCT, REFERRAL_REWARD_DAYS, appOrigin, referralOverview, shortName, type ReferralOverview } from "@/lib/referral";
import { getT } from "@/lib/i18n/server";
import { I18nScope } from "@/lib/i18n/scope";
import { ShareInvite } from "./_components/share-invite";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("referralPage.metaTitle") };
}

const STATUS_TONE: Record<ReferralOverview["friends"][number]["status"], Tone> = { signed_up: "neutral", paid: "teal", rewarded: "green" };
/** What referralOverview() shows for a friend with no stored name — replaced by the translated word. */
const NAMELESS = shortName("");

export default async function ReferralPage() {
  const user = await requireUser();
  const [data, h, t] = await Promise.all([referralOverview(user.id), headers(), getT()]);
  const url = `${appOrigin(h.get("host"))}/r/${data.code}`;
  const pct = REFERRAL_DISCOUNT_PCT;
  const days = REFERRAL_REWARD_DAYS;
  const text = t("referralPage.shareText", { pct });
  const steps = [
    { icon: Link2, title: t("referralPage.steps.linkTitle"), text: t("referralPage.steps.linkText") },
    { icon: Wallet, title: t("referralPage.steps.friendTitle", { pct }), text: t("referralPage.steps.friendText", { pct }) },
    { icon: CalendarPlus, title: t("referralPage.steps.youTitle", { days }), text: t("referralPage.steps.youText", { days }) },
  ];
  const statusLabel = {
    signed_up: t("referralPage.status.signedUp"),
    paid: t("referralPage.status.paid", { days }),
    rewarded: t("referralPage.status.rewarded", { days }),
  };
  const { invited, paid, daysEarned, daysPending } = data.stats;

  return (
    <>
      <PageHeader
        eyebrow={t("referralPage.eyebrow")}
        title={t.rich("referralPage.title", {}, { s: (c) => <Script>{c}</Script> })}
        sub={t("referralPage.sub", { pct, days })}
      />

      <div className="flex flex-col gap-6">
        <Card strong className="flex animate-rise flex-col gap-5">
          <Label>{t("referralPage.yourLink")}</Label>
          <I18nScope ns={["referralPage"]}>
            <ShareInvite url={url} code={data.code} text={text} />
          </I18nScope>
        </Card>

        <Card className="animate-rise" style={{ animationDelay: "80ms" }}>
          <dl className="grid grid-cols-3 gap-4">
            {[
              { l: t("referralPage.stats.invited"), v: t.num(invited) },
              { l: t("referralPage.stats.paid"), v: t.num(paid) },
              { l: t("referralPage.stats.daysEarned"), v: daysEarned ? `+${t.num(daysEarned)}` : "0", green: daysEarned > 0 },
            ].map((x) => (
              <div key={x.l} className="flex flex-col-reverse justify-end gap-1.5">
                <dt className="label !text-[11px] break-words">{x.l}</dt>
                <dd className={cx("num text-[32px] leading-none", x.green ? "text-green" : "text-head")}>{x.v}</dd>
              </div>
            ))}
          </dl>
          {daysPending > 0 && <p className="mt-4 border-t border-line pt-3 text-[12.5px] text-ink-3">{t("referralPage.pending", { n: daysPending })}</p>}
        </Card>
      </div>

      <section aria-labelledby="how-h" className="mt-10">
        <Label className="mb-4"><span id="how-h">{t("referralPage.howTitle")}</span></Label>
        <ol className="grid gap-4 md:grid-cols-3">
          {steps.map((s, i) => (
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
          {t("referralPage.rules")}
        </p>
      </section>

      <section aria-labelledby="friends-h" className="mt-10">
        <Card>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <Label><span id="friends-h">{t("referralPage.friendsTitle")}</span></Label>
            {invited > 0 && <span className="text-[12.5px] text-ink-3">{t("referralPage.friendsCount", { n: invited })}</span>}
          </div>
          {data.friends.length === 0 ? (
            <p className="text-[14px] text-ink-3">{t("referralPage.empty")}</p>
          ) : (
            <ul className="flex flex-col divide-y divide-line">
              {data.friends.map((f) => (
                <li key={f.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0">
                  <div className="min-w-0">
                    <div className="break-words text-[14px] text-head">{f.name === NAMELESS ? t("referralPage.friendFallback") : f.name}</div>
                    <div className="truncate text-[12.5px] text-ink-3">
                      {f.email} · {f.status === "rewarded" && f.rewardedAt ? t("referralPage.paidOn", { date: t.date(f.rewardedAt, "dayMonthShort") }) : t("referralPage.since", { date: t.date(f.createdAt, "dayMonthShort") })}
                    </div>
                  </div>
                  <Chip tone={STATUS_TONE[f.status]}>{statusLabel[f.status]}</Chip>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>
    </>
  );
}
