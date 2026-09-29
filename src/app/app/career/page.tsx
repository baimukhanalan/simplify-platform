import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, ArrowUpRight, Camera, Compass, Gauge, Lightbulb, Moon, Rocket, Target, TrendingUp, UserRound } from "lucide-react";
import { realUrl } from "@/lib/links";
import { requireUser } from "@/lib/auth";
import { db, j } from "@/lib/db";
import { ButtonLink, Card, Chip, Label, Progress, Ring, Script, cx } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { setCareerMode, recordSnapshot } from "@/lib/actions/account";
import { ROLE_FAMILIES, SENIORITY, seniorityFromYears, type Seniority } from "@/lib/engine/taxonomy";
import { getT } from "@/lib/i18n/server";
import type { T } from "@/lib/i18n/translator";
import { regionNames, seniorityName } from "@/lib/i18n/labels";
import { agentState } from "../_components/today-data";
import { betterPayingRoles, careerHistory } from "@/lib/career";
import { loadCareer } from "./_components/data";
import { HistoryChart } from "./_components/history-chart";
import { BREAKDOWN, baseRole, nextMilestone, recommendation } from "./_components/next-step";
import { placeWithFormat } from "../../_components/ru";

export async function generateMetadata() {
  return { title: (await getT())("careerPage.metaTitle") };
}

const FORMATS = ["remote", "hybrid", "onsite"] as const;
/**
 * A job's place plus work format. Russian keeps the shared placeWithFormat (localized place names); other languages
 * show the place as stored and the format in the page language, never said twice.
 */
function placeLine(t: T, place: string | null | undefined, format: string | null | undefined) {
  if (t.locale === "ru") return placeWithFormat(place, format);
  const k = (format ?? "").toLowerCase();
  const f = (FORMATS as readonly string[]).includes(k) ? t(`careerPage.better.${k as (typeof FORMATS)[number]}`) : "";
  const p = (place ?? "").trim().replace(/\s*\((?:remote|hybrid|on-?site|office)\)\s*$/i, "").trim();
  if (!f) return p;
  if (!p) return f.charAt(0).toUpperCase() + f.slice(1);
  return p.toLowerCase().includes(f) ? p : `${p} · ${f}`;
}
const toneFor = (v: number) => (v >= 75 ? "green" : v >= 50 ? "teal" : v >= 30 ? "amber" : "rose") as "green" | "teal" | "amber" | "rose";

export default async function CareerPage({ searchParams }: { searchParams: Promise<{ hired?: string }> }) {
  const [user, sp] = await Promise.all([requireUser(), searchParams]);
  // markHired lands here with ?hired=1 — the celebration lives on its own page.
  if (sp.hired === "1") redirect("/app/hired");

  const [c, t] = await Promise.all([loadCareer(user.id), getT()]);
  /** "$58 000" — one money format for the whole product, in the page language. */
  const usd = (n: number) => t.money(n, "USD");
  const passive = user.careerMode === "passive";
  const [history, better, hiredCampaign, agent] = await Promise.all([
    // Today's point is the live score from the header; earlier points are the recorded snapshots.
    careerHistory(user.id, { score: c.score, marketValue: c.marketValue }),
    // Salary Intelligence: roles of the family in the goal regions paying 25%+ more (src/lib/career.ts).
    betterPayingRoles(c),
    db.campaign.findFirst({ where: { userId: user.id, status: "hired" }, select: { id: true } }),
    agentState(user),
  ]);
  const threshold = better.threshold;
  const betterCount = better.count;

  const currentTitle = c.accepted ? c.accepted.role : c.role;
  const familyLabel = c.family !== "other" && ROLE_FAMILIES[c.family] ? ROLE_FAMILIES[c.family].label : baseRole(currentTitle) || t("careerPage.better.yourRole");
  // One level everywhere: loadCareer's seniority (the goal's level, years only without a goal) — same as the market range.
  const level = (SENIORITY as readonly string[]).includes(c.seniority) ? (c.seniority as Seniority) : seniorityFromYears(c.user.profile?.yearsExperience ?? 0);
  const milestone = nextMilestone(c.family, level, currentTitle || c.role);
  const rec = recommendation(t, { components: c.components, family: c.family, skills: j<string[]>(c.user.profile?.skills, []), nextLevel: milestone?.level ?? null, mockCount: c.mockCount });
  const running = agent.running;
  const eyebrow = t(`careerPage.eyebrow.${running ? "running" : c.accepted ? "afterHired" : agent.hasCampaign ? "between" : "career"}`);
  const basis = [seniorityName(t, c.marketBasis.level), regionNames(t, c.marketBasis.regions)].filter(Boolean).join(" · ");
  const compLabel = c.compensationKind === "actual" ? t("careerPage.overview.compLabelActual") : c.salarySource === "profile" ? t("careerPage.overview.compLabelProfile") : c.salarySource === "goal" ? t("careerPage.overview.compLabelGoal") : "";
  const goalLink = (key: "setInGoal" | "setTargetRole") => <Link href="/app/goal" className="underline underline-offset-2">{t(`careerPage.overview.${key}`)}</Link>;
  const passiveState = agent.searching ? "Searching" : passive ? "Passive" : agent.paused ? "Paused" : running ? "SearchOff" : "None";
  const gapPct = c.currentSalary && c.marketValue ? Math.round((c.gap / c.marketValue) * 100) : 0;

  return (
    <>
      {/* ── Header ─────────────────────────────────────────── */}
      <div className="mb-7 flex flex-col gap-2.5 animate-rise">
        <Label>{eyebrow}</Label>
        <h1 className="h-serif text-[clamp(30px,3.6vw,46px)]">{t.rich("careerPage.title", {}, { s: (x) => <Script>{x}</Script> })}</h1>
        <p className="max-w-2xl text-[15px] text-ink-2">{t("careerPage.intro")}{agent.hasCampaign && !running ? ` ${t("careerPage.introWatching")}` : ""}</p>
      </div>

      {/* ── Overview ───────────────────────────────────────── */}
      <Card strong className="animate-rise !p-0">
        <div className="grid gap-px overflow-hidden rounded-[22px] bg-line sm:grid-cols-2 lg:grid-cols-[1.35fr_1fr_1fr_1fr]">
          <div className="flex items-center gap-5 bg-white/90 p-5 sm:col-span-2 sm:p-6 lg:col-span-1">
            <Ring value={c.score} size={112} stroke={8} label="Career Score" className="shrink-0" />
            <div className="flex min-w-0 flex-col gap-1.5">
              <span className="label">{t("careerPage.overview.currentRole")}</span>
              <span className="h-serif text-[clamp(20px,2vw,26px)]">{currentTitle || t("careerPage.overview.roleNotSet")}</span>
              <span className="truncate text-[13.5px] text-ink-3">{c.accepted ? t("careerPage.overview.atCompany", { company: c.accepted.company }) : currentTitle ? t("careerPage.overview.campaignGoal") : goalLink("setInGoal")}</span>
            </div>
          </div>
          <Tile label="Market Value" value={usd(c.marketValue)} hint={t("careerPage.overview.marketHint", { basis, low: usd(c.range.low), high: usd(c.range.high) })} />
          <Tile
            label={t(c.compensationKind === "actual" ? "careerPage.overview.compActual" : "careerPage.overview.compExpected")}
            value={c.currentSalary ? usd(c.currentSalary) : "—"}
            hint={compLabel || <Link href="/app/profile#conditions" className="underline underline-offset-2">{t("careerPage.overview.setInProfile")}</Link>}
            tone={c.underpaid ? "rose" : undefined}
          />
          {milestone ? (
            <Tile label={t("careerPage.overview.nextStep")} value={milestone.title} hint={t("careerPage.overview.nextLevelAfter", { level: seniorityName(t, level) })} serif />
          ) : (
            <Tile label={t("careerPage.overview.nextStep")} value="—" hint={goalLink("setTargetRole")} />
          )}
        </div>
      </Card>

      {c.underpaid && (
        <p role="note" className="mt-3 rounded-2xl border border-rose/15 bg-rose-soft px-4 py-3 text-[14px] text-ink-2">
          {t.rich("careerPage.overview.underpaid", { pct: Math.abs(gapPct), gap: usd(c.gap) }, { b: (x) => <span className="font-medium text-head">{x}</span> })}
        </p>
      )}

      {/* ── Passive mode ───────────────────────────────────── */}
      <section aria-labelledby="passive-h" className="relative isolate mt-6 animate-rise overflow-hidden rounded-[24px] bg-[#0c1512] px-5 py-7 text-white sm:px-8 sm:py-8" style={{ animationDelay: "80ms" }}>
        <div aria-hidden className="pointer-events-none absolute -right-32 -top-32 -z-10 size-[420px] rounded-full bg-[radial-gradient(circle,rgb(127_227_182/.18),transparent_65%)]" />
        <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-xl">
            <div className="flex items-center gap-2">
              <span className={cx("size-2 rounded-full", passive ? "bg-[#7fe3b6] shadow-[0_0_0_4px_rgb(127_227_182/.18)]" : "bg-white/30")} aria-hidden />
              <span className="font-mono text-[11px] uppercase tracking-[.12em] text-[#8fc7ad]">{t("careerPage.passive.status", { on: passive ? "yes" : "no" })}</span>
            </div>
            <h2 id="passive-h" className="h-serif mt-3 text-[clamp(24px,3vw,34px)] !text-white">
              {t(`careerPage.passive.title${passiveState}`)}<span className="text-[#7fe3b6]">.</span>
            </h2>
            <p className="mt-2 text-[14.5px] text-white/70">
              {t(`careerPage.passive.text${passiveState}`)}
            </p>
          </div>
          <div role="group" aria-label={t("careerPage.passive.groupAria")} className="inline-flex w-fit shrink-0 gap-1 rounded-full border border-white/15 bg-white/[.05] p-1">
            <ModeButton mode="passive" current={passive} icon={<Moon className="size-4" strokeWidth={1.7} aria-hidden />}>{t("careerPage.passive.passiveBtn")}<span className="hidden sm:inline">{t("careerPage.passive.passiveBtnSuffix")}</span></ModeButton>
            <ModeButton mode="active" current={!passive} icon={<Rocket className="size-4" strokeWidth={1.7} aria-hidden />}>{t("careerPage.passive.activeBtn")}</ModeButton>
          </div>
        </div>
        <div className="mt-6 flex flex-col gap-3 border-t border-white/10 pt-5 sm:flex-row sm:items-center sm:justify-between">
          {c.currentSalary === 0 ? (
            <p className="text-[14px] text-white/70">{t.rich("careerPage.passive.salaryMissing", {}, { link: (x) => <Link href="/app/profile#conditions" className="text-white underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-[#7fe3b6]">{x}</Link> })}</p>
          ) : (
            <p className="text-[15px] text-white/85">
              <span className="num text-[26px] leading-none text-[#7fe3b6]">{betterCount}</span>{" "}
              {t("careerPage.passive.betterRoles", { n: betterCount, comp: c.compensationKind === "actual" ? "actual" : "expectation" })}
              <span className="text-white/50"> {t("careerPage.passive.fromThreshold", { amount: usd(threshold) })}</span>
            </p>
          )}
          {betterCount > 0 && (
            <a href="#better-roles" className="inline-flex h-10 w-fit shrink-0 items-center gap-2 rounded-full bg-[#7fe3b6] px-5 text-[14px] font-medium text-[#0c1512] transition hover:bg-[#9aeec7] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[#7fe3b6]">
              {t("careerPage.passive.see")}<ArrowRight className="size-4" strokeWidth={1.8} aria-hidden />
            </a>
          )}
        </div>
      </section>

      {/* ── Score breakdown + next move ────────────────────── */}
      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Card className="animate-rise" style={{ animationDelay: "140ms" }}>
          <div className="mb-5 flex items-baseline justify-between gap-3">
            <Label>Career Score</Label>
            <span className="num text-[14px] text-ink-3"><span className="text-[22px] text-head">{c.score}</span> / 100</span>
          </div>
          <ul className="flex flex-col gap-4">
            {BREAKDOWN.map((key) => {
              const v = c.components[key];
              return (
                <li key={key} className="flex flex-col gap-1.5">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className={cx("text-[14px]", key === rec.key ? "font-medium text-head" : "text-ink-2")}>{t(`careerPage.breakdown.${key}`)}</span>
                    <span className="num text-[14px] text-head">{v}</span>
                  </div>
                  <Progress value={v} tone={toneFor(v)} />
                </li>
              );
            })}
          </ul>
          <div className="mt-6 flex flex-col gap-3 rounded-2xl bg-mint-2 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="flex gap-2.5 text-[14px] text-ink-2">
              <TrendingUp className="mt-0.5 size-4 shrink-0 text-green" strokeWidth={1.8} aria-hidden />
              <span>{rec.text}</span>
            </p>
            <Link href={rec.href} className="inline-flex h-10 w-fit shrink-0 items-center gap-1 rounded-full px-3 text-[13px] font-medium text-green transition hover:bg-white/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green">
              {rec.cta}<ArrowRight className="size-3.5" strokeWidth={1.8} aria-hidden />
            </Link>
          </div>
        </Card>

        <div className="flex min-w-0 flex-col gap-6">
          <Card strong className="flex animate-rise flex-col gap-4" style={{ animationDelay: "200ms" }}>
            <Label>{t("careerPage.next.label")}</Label>
            {running ? (
              <>
                <h2 className="h-serif text-[clamp(24px,2.6vw,30px)]">{t.rich("careerPage.next.runningTitle", {}, { s: (x) => <Script>{x}</Script> })}</h2>
                <p className="text-[14px] text-ink-3">{t(agent.paused ? "careerPage.next.runningPaused" : "careerPage.next.runningText")}</p>
                <ButtonLink href={agent.paused ? "/app/campaign" : "/app"} size="lg" variant="glass" className="w-fit">{t(agent.paused ? "careerPage.next.openCampaign" : "careerPage.next.openToday")}<ArrowRight className="size-4" strokeWidth={1.7} aria-hidden /></ButtonLink>
              </>
            ) : (
              <>
                <h2 className="h-serif text-[clamp(24px,2.6vw,30px)]">{t.rich("careerPage.next.readyTitle", {}, { s: (x) => <Script>{x}</Script> })}</h2>
                <p className="text-[14px] text-ink-3">
                  {t(agent.hasCampaign ? "careerPage.next.readyTextRepeat" : "careerPage.next.readyTextFirst")}
                </p>
                <ButtonLink href="/app/campaign" size="lg" className="w-fit"><Rocket className="size-4" strokeWidth={1.7} aria-hidden />{t(agent.hasCampaign ? "careerPage.next.startNext" : "careerPage.next.startFirst")}</ButtonLink>
              </>
            )}
            {hiredCampaign && (
              <Link href="/app/hired" className="inline-flex min-h-10 w-fit items-center rounded text-[13px] text-teal underline-offset-4 hover:text-head hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green">
                {t("careerPage.next.lastHired")}
              </Link>
            )}
          </Card>
          <nav aria-label={t("careerPage.hub.aria")} className="grid animate-rise grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2" style={{ animationDelay: "240ms" }}>
            <HubLink href="/app/profile" icon={<UserRound className="size-4" strokeWidth={1.7} aria-hidden />} title="Career Profile" sub={t("careerPage.hub.profileSub")} />
            <HubLink href="/app/goal" icon={<Target className="size-4" strokeWidth={1.7} aria-hidden />} title={t("careerPage.hub.goal")} sub={t("careerPage.hub.goalSub")} />
            <HubLink href="/app/readiness" icon={<Gauge className="size-4" strokeWidth={1.7} aria-hidden />} title="Readiness" sub={t("careerPage.hub.readinessSub")} />
            <HubLink href="/app/insights" icon={<Lightbulb className="size-4" strokeWidth={1.7} aria-hidden />} title={t("careerPage.hub.insights")} sub={t("careerPage.hub.insightsSub")} />
          </nav>
        </div>
      </div>

      {/* ── Roles that pay more ────────────────────────────── */}
      <section id="better-roles" aria-labelledby="better-h" className="mt-12 scroll-mt-24">
        <div className="mb-4 flex flex-col gap-1.5">
          <Label>{t("careerPage.better.label")}</Label>
          <h2 id="better-h" className="h-serif text-[clamp(22px,2.4vw,30px)]">{t("careerPage.better.title")}</h2>
          {c.currentSalary > 0 && <p className="text-[14px] text-ink-3">{betterCount > better.list.length ? t("careerPage.better.subShown", { family: familyLabel, amount: usd(threshold), shown: better.list.length, total: betterCount }) : t("careerPage.better.sub", { family: familyLabel, amount: usd(threshold) })}</p>}
        </div>
        {c.currentSalary === 0 ? (
          <Card className="text-[14px] text-ink-3">{t("careerPage.better.noSalary")}</Card>
        ) : better.list.length === 0 ? (
          <Card className="text-[14px] text-ink-3">{t("careerPage.better.none")}</Card>
        ) : (
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,260px),1fr))] gap-3">
            {better.list.map((jb) => {
              const uplift = Math.round((jb.mid / c.currentSalary - 1) * 100);
              return (
                <li key={jb.id} className="glass flex min-w-0 flex-col gap-3 p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="break-words text-[15px] text-head">{jb.title}</div>
                      <div className="truncate text-[13px] text-ink-3">{jb.company} · {placeLine(t, jb.location, jb.remote)}</div>
                    </div>
                    <Chip tone="green" className="shrink-0"><span className="sr-only">{t("careerPage.better.srAverage")} </span>+{uplift}%</Chip>
                  </div>
                  <div className="num mt-auto break-words text-[18px] text-head">{jb.salaryMin ? `${usd(jb.salaryMin)}–${usd(jb.salaryMax ?? 0)}` : t("careerPage.better.upTo", { amount: usd(jb.salaryMax ?? 0) })}</div>
                  {realUrl(jb.url) && (
                    <a href={realUrl(jb.url)!} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-10 w-fit items-center gap-1 rounded text-[13px] text-teal underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green">
                      {t("careerPage.better.vacancy")}<ArrowUpRight className="size-3.5" strokeWidth={1.7} aria-hidden /><span className="sr-only"> {t("careerPage.better.newTab")}</span>
                    </a>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <Link href="/app/opportunities" className="mt-3 inline-flex min-h-10 items-center gap-1.5 rounded text-[13.5px] text-teal underline-offset-4 hover:text-head hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green">
          <Compass className="size-4" strokeWidth={1.7} aria-hidden />{t("careerPage.better.all")}
        </Link>
      </section>

      {/* ── History ────────────────────────────────────────── */}
      <Card className="mt-12">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-col gap-1">
            <Label>{t("careerPage.history.label")}</Label>
            <p className="text-[13px] text-ink-3">{t("careerPage.history.sub")}</p>
          </div>
          <form action={recordSnapshot}>
            <SubmitButton size="sm" variant="glass" pendingText={t("careerPage.history.recording")} className="!h-10"><Camera className="size-3.5" strokeWidth={1.7} aria-hidden />{t("careerPage.history.record")}</SubmitButton>
          </form>
        </div>
        {history.length >= 2 ? (
          <HistoryChart points={history} />
        ) : (
          <p className="py-8 text-center text-[14px] text-ink-3">
            {t.rich("careerPage.history.empty", { score: c.score }, { b: (x) => <span className="num text-head">{x}</span> })}
          </p>
        )}
      </Card>
    </>
  );
}

function Tile({ label, value, hint, tone, serif }: { label: string; value: string; hint: React.ReactNode; tone?: "rose"; serif?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5 bg-white/90 p-5 sm:p-6">
      <span className="label">{label}</span>
      <span className={cx(serif ? "h-serif text-[clamp(20px,2vw,24px)]" : "num text-[34px] leading-none", tone === "rose" ? "text-rose" : "text-head")}>{value}</span>
      <span className="text-[12.5px] text-ink-3">{hint}</span>
    </div>
  );
}

function HubLink({ href, icon, title, sub }: { href: string; icon: React.ReactNode; title: string; sub: string }) {
  return (
    <Link href={href} className="glass group flex items-center gap-3 !rounded-2xl px-4 py-3 transition hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green">
      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-mint text-green">{icon}</span>
      <span className="flex min-w-0 flex-col">
        <span className="text-[14px] font-medium text-head">{title}</span>
        <span className="truncate text-[12px] text-ink-3">{sub}</span>
      </span>
      <ArrowRight className="ml-auto size-4 shrink-0 text-ink-4 transition group-hover:translate-x-0.5 group-hover:text-head" strokeWidth={1.7} aria-hidden />
    </Link>
  );
}

function ModeButton({ mode, current, icon, children }: { mode: "active" | "passive"; current: boolean; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <form action={setCareerMode}>
      <input type="hidden" name="mode" value={mode} />
      <button
        type="submit"
        aria-pressed={current}
        disabled={current}
        className={cx(
          "inline-flex h-10 items-center gap-2 rounded-full px-4 text-[13.5px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7fe3b6]",
          current ? "bg-[#7fe3b6] text-[#0c1512]" : "text-white/75 hover:bg-white/10 hover:text-white",
        )}
      >
        {icon}{children}
      </button>
    </form>
  );
}
