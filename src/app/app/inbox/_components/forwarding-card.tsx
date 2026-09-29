import { ExternalLink, KeyRound, MailPlus } from "lucide-react";
import type { ForwardingStatus } from "@/lib/inbound/service";
import { dismissForwardingCode } from "@/lib/inbound/actions";
import { Chip, cx } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { getT } from "@/lib/i18n/server";
import type { MessageKey, T } from "@/lib/i18n/translator";
import { agoT, dateTimeT } from "../../opportunities/_lib/labels";
import { CopyButton, ProviderGuide, RegenerateAlias, type Guide } from "./forwarding-client";

// Words employer mail almost always carries (RU + EN) — filter content, the same in every interface language.
const WORDS_RU = "вакансия, отклик, собеседование, интервью, оффер, резюме";
const WORDS_EN = "interview, application, offer, recruiting, careers";
const GMAIL_QUERY = "{вакансия отклик собеседование интервью оффер резюме interview application offer recruiting careers}";
const WORDS = `${WORDS_RU}, ${WORDS_EN}`;

function guides(t: T, address: string): Guide[] {
  return [
    {
      key: "gmail",
      label: "Gmail",
      steps: [
        { text: t("inbox.gmail1"), copy: address },
        { text: t("inbox.gmail2") },
        { text: t("inbox.gmail3"), copy: GMAIL_QUERY },
        { text: t("inbox.gmail4") },
      ],
      note: t("inbox.gmailNote"),
    },
    {
      key: "outlook",
      label: "Outlook",
      steps: [
        { text: t("inbox.outlook1") },
        { text: t("inbox.outlook2", { words: WORDS }) },
        { text: t("inbox.outlook3"), copy: address },
      ],
      note: t("inbox.outlookNote"),
    },
    {
      key: "mailru",
      label: "Mail.ru",
      steps: [
        { text: t("inbox.mailru1") },
        { text: t("inbox.mailru2", { words: WORDS }) },
        { text: t("inbox.mailru3"), copy: address },
        { text: t("inbox.mailru4") },
      ],
    },
    {
      key: "yandex",
      label: t("inbox.guideYandex"),
      steps: [
        { text: t("inbox.yandex1") },
        { text: t("inbox.yandex2", { words: WORDS }) },
        { text: t("inbox.yandex3"), copy: address },
        { text: t("inbox.yandex4") },
      ],
    },
  ];
}

/** Mail providers by name (PROVIDER_RU in src/lib/inbound/verify.ts); `fem`: Russian verb agreement («Яндекс Почта прислала»). */
const PROVIDER: Record<string, { key: MessageKey; fem: boolean }> = {
  gmail: { key: "inbox.providerGmail", fem: false },
  yandex: { key: "inbox.providerYandex", fem: true },
  mailru: { key: "inbox.providerMailru", fem: true },
  outlook: { key: "inbox.providerOutlook", fem: false },
};

/** «Пересылка писем»: the personal forwarding address, its status and set-up instructions per mail provider. */
export async function ForwardingCard({ status }: { status: ForwardingStatus }) {
  const t = await getT();
  const { address, lastAt, verification: v } = status;
  const provider = v ? PROVIDER[v.provider] : null;
  const working = status.state === "simulated" || Boolean(lastAt);
  const addrId = "forwarding-address";
  const codeId = "forwarding-code";
  return (
    <section aria-labelledby="forwarding-title" className={cx("flex flex-col gap-5 p-5 sm:p-6", v ? "glass-strong" : "glass")}>
      <div className="flex items-start gap-3.5">
        <span className="grid size-10 shrink-0 place-items-center rounded-full border border-stroke bg-white text-teal">
          <MailPlus className="size-[18px]" strokeWidth={1.7} aria-hidden />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="forwarding-title" className="text-[15.5px] font-medium text-head">{t("inbox.fwdTitle")}</h2>
            {v ? (
              <Chip tone="amber" dot>{t("inbox.fwdNeedConfirm")}</Chip>
            ) : working ? (
              <Chip tone="green" dot>{t("inbox.fwdWorking")}</Chip>
            ) : (
              <Chip tone="amber">{t("inbox.fwdWaiting")}</Chip>
            )}
          </div>
          <p className="text-[13.5px] text-ink-3">
            {working ? (
              lastAt ? (
                t.rich("inbox.fwdLast", { ago: agoT(t, lastAt) }, { t: (c) => <time dateTime={lastAt.toISOString()} title={dateTimeT(t, lastAt)}>{c}</time> })
              ) : (
                t("inbox.fwdAuto")
              )
            ) : (
              t("inbox.fwdSetup")
            )}
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <span className="label !text-[11px]">{t("inbox.fwdAddress")}</span>
        <div className="flex flex-wrap items-center gap-2">
          <code id={addrId} className="min-w-0 flex-1 basis-56 break-all rounded-2xl border border-line bg-white/80 px-4 py-2.5 font-mono text-[14px] text-head">{address}</code>
          <CopyButton value={address} targetId={addrId} label={t("inbox.fwdCopyAddress")} />
        </div>
        <RegenerateAlias />
      </div>

      {v && (
        <div role="status" className="flex flex-col gap-3 rounded-2xl border border-amber/20 bg-amber-soft/50 p-4">
          <div className="flex items-start gap-2.5">
            <KeyRound className="mt-0.5 size-4 shrink-0 text-amber" strokeWidth={1.8} aria-hidden />
            <p className="text-[13.5px] text-ink-2">
              {t("inbox.fwdVerifySent", { provider: provider ? t(provider.key) : v.provider, fem: provider?.fem ? "yes" : "no" })}
              {v.requester ? t.rich("inbox.fwdVerifyFor", { requester: v.requester }, { r: (c) => <span className="break-all text-head">{c}</span> }) : null}
              {" "}<time dateTime={v.at.toISOString()} className="text-ink-3">{agoT(t, v.at)}</time>.{" "}
              {t(v.code ? "inbox.fwdEnterCode" : "inbox.fwdOpenLink")}
              {v.code && v.link ? t("inbox.fwdOrLink") : "."}
            </p>
          </div>
          {v.code && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="label !text-[11px]">{t("inbox.fwdCode")}</span>
              <code id={codeId} className="num rounded-xl border border-line bg-white px-3.5 py-1.5 font-mono text-[20px] tracking-[.12em] text-head">{v.code}</code>
              <CopyButton value={v.code} targetId={codeId} label={t("inbox.fwdCopyCode")} />
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {v.link && (
              <a href={v.link} target="_blank" rel="noopener noreferrer" className="inline-flex h-10 items-center gap-2 rounded-full bg-cta px-4 text-[13.5px] font-medium text-white shadow-(--shadow-cta) hover:bg-[#2f2c2c] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green">
                {t(v.provider === "gmail" ? "inbox.fwdConfirmGmail" : "inbox.fwdOpenConfirm")}<ExternalLink className="size-4" aria-hidden /><span className="sr-only"> {t("work.newTab")}</span>
              </a>
            )}
            <form action={dismissForwardingCode}>
              <SubmitButton variant="ghost" size="sm" pendingText={t("inbox.fwdHiding")}>{t("inbox.fwdDone")}</SubmitButton>
            </form>
          </div>
        </div>
      )}

      <details className="group" open={!working && !v ? true : undefined}>
        <summary className="inline-flex min-h-10 cursor-pointer list-none items-center gap-1.5 rounded text-[13px] text-teal hover:text-head focus-visible:outline-2 focus-visible:outline-green [&::-webkit-details-marker]:hidden">
          <span className="group-open:hidden">{t("inbox.fwdHowTo")}</span><span className="hidden group-open:inline">{t("inbox.fwdHideHowTo")}</span>
        </summary>
        <div className="mt-3">
          <ProviderGuide guides={guides(t, address)} />
        </div>
      </details>
    </section>
  );
}
