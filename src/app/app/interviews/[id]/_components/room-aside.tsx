import Link from "next/link";
import { ArrowRight, ArrowUpRight, FileText, Radio } from "lucide-react";
import { ButtonLink, Card, Label, Ring, cx } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { setCopilotAllowed } from "@/lib/actions/interview";
import type { roomReadiness } from "@/lib/engine/interview-readiness";
import { getT } from "@/lib/i18n/server";
import { INTL_TAG, TIME_ZONE } from "@/lib/i18n/config";
import { daysWordT, roundName } from "../../_components/format";
import { almatyDayDiff } from "../../../../_components/ru";

type Props = {
  iv: { id: string; round: string; status: string; scheduledAt: Date | null; copilotAllowed: boolean; opportunityId: string };
  /** Readiness for this one interview (not the general Interview readiness of Career Score). */
  readiness: ReturnType<typeof roomReadiness>;
  pkg: { cvVersion: string; cover: boolean; answers: number } | null;
  now: number;
  /** STAR stories in the library (the «N в библиотеке» hint). */
  stories: number;
};

const DURATION = ["assessment", "recruiter", "hiring_manager", "technical", "final"] as const;
/** roomReadiness() parts, in its fixed order: Match, mock, STAR stories, brief & answers. */
const PART_KEYS = ["match", "mock", "stories", "pack"] as const;

export async function RoomAside({ iv, readiness, pkg, now, stories }: Props) {
  const t = await getT();
  const { score } = readiness;
  const at = iv.scheduledAt;
  const ms = at ? at.getTime() - now : null;
  const countdown =
    ms == null ? null : ms <= 0 ? null : ms < 3600000 ? t("interviewsPage.format.minutes", { n: Math.max(1, Math.round(ms / 60000)) }) : ms < 86400000 ? t("interviewsPage.format.hours", { n: Math.round(ms / 3600000) }) : daysWordT(t, Math.max(1, almatyDayDiff(at!, now)));
  const isAssessment = iv.round === "assessment";
  const title = isAssessment ? t("interviewsPage.aside.readyTitleAssessment") : t("interviewsPage.aside.readyTitle");
  const weekday = at ? new Intl.DateTimeFormat(INTL_TAG[t.locale], { timeZone: TIME_ZONE, weekday: "long" }).format(at) : "";
  const duration = (DURATION as readonly string[]).includes(iv.round) ? t(`interviewsPage.aside.duration.${iv.round as (typeof DURATION)[number]}`) : t("interviewsPage.aside.duration.other");
  const partLabel = (k: (typeof PART_KEYS)[number] | undefined, fallback: string) =>
    k === "match" ? t("interviewsPage.aside.parts.match")
      : k === "mock" ? (isAssessment ? t("interviewsPage.aside.parts.mockAssessment") : t("interviewsPage.aside.parts.mock"))
        : k === "stories" ? t("interviewsPage.aside.parts.stories")
          : k === "pack" ? t("interviewsPage.aside.parts.pack")
            : fallback;
  const partHint = (k: (typeof PART_KEYS)[number] | undefined, p: { score: number | null; hint?: string }) =>
    k === "mock" ? (p.score == null ? t("interviewsPage.aside.parts.notYet") : t("interviewsPage.aside.parts.best"))
      : k === "stories" ? t("interviewsPage.aside.parts.inLibrary", { n: stories })
        : p.hint;
  const live = iv.status === "upcoming" && !isAssessment;

  return (
    <aside className="flex flex-col gap-4 lg:sticky lg:top-6 lg:self-start" aria-label={isAssessment ? t("interviewsPage.aside.ariaAssessment") : t("interviewsPage.aside.ariaInterview")}>
      <Card strong className="!p-5">
        <Label className="mb-3">{isAssessment ? t("interviewsPage.aside.deadline") : t("interviewsPage.aside.when")}</Label>
        {at ? (
          <>
            <div className="num text-[28px] leading-none text-head">
              {t.date(at, "dayMonth")}
            </div>
            <div className="mt-1 text-[13px] text-ink-3">{t.locale === "en" ? weekday : weekday.toLowerCase()}</div>
            <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2 text-[14px] text-ink-2">
              <span className="num">{t.time(at)}</span>
              <span className="text-ink-4">{t("interviewsPage.aside.almaty")}</span>
              <span className="text-ink-4">·</span>
              <span>{duration}</span>
            </div>
            {countdown && iv.status === "upcoming" && (
              <p className="mt-3 inline-flex items-center gap-2 rounded-full bg-green-soft px-3 py-1 text-[12.5px] text-green">
                <span aria-hidden className="size-1.5 rounded-full bg-green animate-pulse-dot" />
                <span>{t.rich(isAssessment ? "interviewsPage.aside.countdownLeft" : "interviewsPage.aside.countdownIn", { v: countdown }, { n: (c) => <span className="num">{c}</span> })}</span>
              </p>
            )}
          </>
        ) : (
          <p className="text-[14px] text-ink-3">{t("interviewsPage.aside.noDate")}</p>
        )}
      </Card>

      <Card className="!p-5">
        <div className="flex items-center gap-4">
          <Ring value={score} size={76} stroke={6} />
          <div className="flex flex-col gap-0.5">
            <Label>{title}</Label>
            <p className="text-[13px] text-ink-3">{isAssessment
              ? (score >= 75 ? t("interviewsPage.aside.readyAssessmentHigh") : score >= 55 ? t("interviewsPage.aside.readyAssessmentMid") : t("interviewsPage.aside.readyAssessmentLow"))
              : (score >= 75 ? t("interviewsPage.aside.readyHigh") : score >= 55 ? t("interviewsPage.aside.readyMid") : t("interviewsPage.aside.readyLow"))}</p>
          </div>
        </div>
        <ul className="mt-4 flex flex-col gap-2">
          {readiness.parts.map((p, i) => {
            const k = readiness.parts.length === PART_KEYS.length ? PART_KEYS[i] : undefined;
            const hint = partHint(k, p);
            return (
            <li key={p.label} className="flex items-baseline justify-between gap-3 text-[13px]">
              <span className="min-w-0 text-ink-3">{partLabel(k, p.label)}{hint && <span className="text-ink-4"> · {hint}</span>}</span>
              {/* A part not done yet (no mock) shows «—», not the placeholder value that feeds the total. */}
              <span className={cx("num", p.score == null ? "text-ink-4" : p.score >= 70 ? "text-green" : "text-head")}>{p.score == null ? "—" : Math.round(p.score)}</span>
            </li>
            );
          })}
        </ul>
      </Card>

      {live && (
        <Card className="!p-5">
          <div className="mb-2 flex items-center gap-2">
            <Radio className="size-4 text-teal" strokeWidth={1.7} aria-hidden />
            <Label>{t("interviewsPage.aside.copilotLabel")}</Label>
          </div>
          {iv.copilotAllowed ? (
            <>
              <p className="text-[13.5px] leading-relaxed text-ink-2">{t("interviewsPage.aside.copilotAllowed")}</p>
              <ButtonLink href={`/app/interviews/${iv.id}/copilot`} size="sm" className="mt-4 !h-10 w-full">{t("interviewsPage.aside.startCopilot")}<ArrowRight className="size-3.5" strokeWidth={1.7} aria-hidden /></ButtonLink>
            </>
          ) : (
            <p className="text-[13.5px] leading-relaxed text-ink-2">{t("interviewsPage.aside.copilotOff", { round: roundName(t, iv.round).toLowerCase() })}</p>
          )}
          <form action={setCopilotAllowed} className="mt-2">
            <input type="hidden" name="id" value={iv.id} />
            <input type="hidden" name="allowed" value={String(!iv.copilotAllowed)} />
            <SubmitButton variant="ghost" size="sm" className="!h-10 w-full whitespace-normal !px-2 !text-[12.5px] !text-ink-3" pendingText={t("interviewsPage.aside.saving")}>
              {iv.copilotAllowed ? t("interviewsPage.aside.hideCopilot") : t("interviewsPage.aside.restoreCopilot")}
            </SubmitButton>
          </form>
        </Card>
      )}

      <Card className="!p-5">
        <div className="mb-3 flex items-center gap-2">
          <FileText className="size-4 text-teal" strokeWidth={1.7} aria-hidden />
          <Label>{t("interviewsPage.aside.sentLabel")}</Label>
        </div>
        {pkg ? (
          <dl className="grid grid-cols-3 gap-2 text-center">
            {[
              [t("interviewsPage.aside.cv"), t("interviewsPage.aside.yes")],
              [t("interviewsPage.aside.letter"), pkg.cover ? t("interviewsPage.aside.yes") : "—"],
              [t("interviewsPage.aside.answers"), String(pkg.answers)],
            ].map(([k, v]) => (
              <div key={k} className="rounded-xl border border-line bg-white/55 px-2 py-2.5">
                <dt className="label !text-[11px]">{k}</dt>
                <dd className="num mt-1 truncate text-[15px] text-head">{v}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="text-[13px] text-ink-3">{t("interviewsPage.aside.outside")}</p>
        )}
        <div className="mt-2 flex flex-col">
          <Link href={`/app/interviews/${iv.id}?tab=sent`} scroll={false} className="inline-flex min-h-10 items-center gap-1.5 rounded text-[13px] text-teal underline-offset-4 hover:text-head hover:underline focus-visible:outline-2 focus-visible:outline-green">
            {isAssessment ? t("interviewsPage.aside.rereadAssessment") : t("interviewsPage.aside.rereadCall")}<ArrowRight className="size-3.5" strokeWidth={1.7} aria-hidden />
          </Link>
          <Link href={`/app/applications/${iv.opportunityId}`} className="inline-flex min-h-10 items-center gap-1.5 rounded text-[13px] text-teal underline-offset-4 hover:text-head hover:underline focus-visible:outline-2 focus-visible:outline-green">
            {t("interviewsPage.aside.appCard")}<ArrowUpRight className="size-3.5" strokeWidth={1.7} aria-hidden />
          </Link>
        </div>
      </Card>
    </aside>
  );
}
