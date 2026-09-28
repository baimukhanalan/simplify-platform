import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, ArrowUpRight, Camera, Compass, Gauge, Lightbulb, Moon, Rocket, Target, TrendingUp, UserRound } from "lucide-react";
import { realUrl } from "@/lib/links";
import { requireUser } from "@/lib/auth";
import { db, j } from "@/lib/db";
import { ButtonLink, Card, Chip, Label, Progress, Ring, Script, cx } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { setCareerMode, recordSnapshot } from "@/lib/actions/account";
import { ROLE_FAMILIES, SENIORITY, SENIORITY_LABEL, seniorityFromYears, type Seniority } from "@/lib/engine/taxonomy";
import { agentState } from "../_components/today-data";
import { betterPayingRoles, careerHistory } from "@/lib/career";
import { loadCareer } from "./_components/data";
import { HistoryChart } from "./_components/history-chart";
import { BREAKDOWN, baseRole, nextMilestone, recommendation } from "./_components/next-step";
import { WORK_MODE_RU, plural } from "../../_components/ru";
import { placeRu } from "@/lib/ru";

export const metadata: Metadata = { title: "Режим карьеры" };

/** "$58 000" — Russian thousands separator (non-breaking space). */
const usd = (n: number) => `$${Math.round(n).toLocaleString("ru-RU")}`;
const kUsd = (n: number) => `$${Math.round(n / 1000)}k`;
const toneFor = (v: number) => (v >= 75 ? "green" : v >= 50 ? "teal" : v >= 30 ? "amber" : "rose") as "green" | "teal" | "amber" | "rose";

export default async function CareerPage({ searchParams }: { searchParams: Promise<{ hired?: string }> }) {
  const [user, sp] = await Promise.all([requireUser(), searchParams]);
  // markHired lands here with ?hired=1 — the celebration lives on its own page.
  if (sp.hired === "1") redirect("/app/hired");

  const c = await loadCareer(user.id);
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
  const compWord = c.compensationKind === "actual" ? "твоей текущей компенсации" : "твоего ожидания по зарплате";

  const currentTitle = c.accepted ? c.accepted.role : c.role;
  const familyLabel = c.family !== "other" && ROLE_FAMILIES[c.family] ? ROLE_FAMILIES[c.family].label : baseRole(currentTitle) || "твоя роль";
  // One level everywhere: loadCareer's seniority (the goal's level, years only without a goal) — same as the market range.
  const level = (SENIORITY as readonly string[]).includes(c.seniority) ? (c.seniority as Seniority) : seniorityFromYears(c.user.profile?.yearsExperience ?? 0);
  const milestone = nextMilestone(c.family, level, currentTitle || c.role);
  const rec = recommendation({ components: c.components, family: c.family, skills: j<string[]>(c.user.profile?.skills, []), nextLevel: milestone?.level ?? null, mockCount: c.mockCount });
  const running = agent.running;
  const eyebrow = running ? "Кампания идёт" : c.accepted ? "После HIRED" : agent.hasCampaign ? "Между кампаниями" : "Карьера";
  const gapPct = c.currentSalary && c.marketValue ? Math.round((c.gap / c.marketValue) * 100) : 0;

  return (
    <>
      {/* ── Header ─────────────────────────────────────────── */}
      <div className="mb-7 flex flex-col gap-2.5 animate-rise">
        <Label>{eyebrow}</Label>
        <h1 className="h-serif text-[clamp(30px,3.6vw,46px)]">Режим <Script>карьеры</Script></h1>
        <p className="max-w-2xl text-[15px] text-ink-2">Career Score, Market Value и следующий шаг — в одном месте.{agent.hasCampaign && !running ? " Агент продолжает следить за рынком и между кампаниями." : ""}</p>
      </div>

      {/* ── Overview ───────────────────────────────────────── */}
      <Card strong className="animate-rise !p-0">
        <div className="grid gap-px overflow-hidden rounded-[22px] bg-line sm:grid-cols-2 lg:grid-cols-[1.35fr_1fr_1fr_1fr]">
          <div className="flex items-center gap-5 bg-white/90 p-5 sm:col-span-2 sm:p-6 lg:col-span-1">
            <Ring value={c.score} size={112} stroke={8} label="Career Score" className="shrink-0" />
            <div className="flex min-w-0 flex-col gap-1.5">
              <span className="label">Текущая роль</span>
              <span className="h-serif text-[clamp(20px,2vw,26px)]">{currentTitle || "Роль не задана"}</span>
              <span className="truncate text-[13.5px] text-ink-3">{c.accepted ? <>в {c.accepted.company}</> : currentTitle ? "цель текущей кампании" : <Link href="/app/goal" className="underline underline-offset-2">задать в разделе «Цель»</Link>}</span>
            </div>
          </div>
          <Tile label="Market Value" value={kUsd(c.marketValue)} hint={`рынок ${kUsd(c.range.low)}–${kUsd(c.range.high)}`} />
          <Tile
            label={c.compensationKind === "actual" ? "Текущая компенсация" : "Ожидание по зарплате"}
            value={c.currentSalary ? kUsd(c.currentSalary) : "—"}
            hint={c.compensationLabel || <Link href="/app/profile#conditions" className="underline underline-offset-2">указать в профиле</Link>}
            tone={c.underpaid ? "rose" : undefined}
          />
          {milestone ? (
            <Tile label="Следующая ступень" value={milestone.title} hint={`следующий уровень после ${SENIORITY_LABEL[level] ?? level}`} serif />
          ) : (
            <Tile label="Следующая ступень" value="—" hint={<Link href="/app/goal" className="underline underline-offset-2">укажи целевую роль в разделе «Цель»</Link>} />
          )}
        </div>
      </Card>

      {c.underpaid && (
        <p role="note" className="mt-3 rounded-2xl border border-rose/15 bg-rose-soft px-4 py-3 text-[14px] text-ink-2">
          <span className="font-medium text-head">Компенсация на {Math.abs(gapPct)}% ниже рыночной оценки</span> (~{usd(c.gap)} в год) — сильный аргумент для пересмотра.
        </p>
      )}

      {/* ── Passive mode ───────────────────────────────────── */}
      <section aria-labelledby="passive-h" className="relative isolate mt-6 animate-rise overflow-hidden rounded-[24px] bg-[#0c1512] px-5 py-7 text-white sm:px-8 sm:py-8" style={{ animationDelay: "80ms" }}>
        <div aria-hidden className="pointer-events-none absolute -right-32 -top-32 -z-10 size-[420px] rounded-full bg-[radial-gradient(circle,rgb(127_227_182/.18),transparent_65%)]" />
        <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-xl">
            <div className="flex items-center gap-2">
              <span className={cx("size-2 rounded-full", passive ? "bg-[#7fe3b6] shadow-[0_0_0_4px_rgb(127_227_182/.18)]" : "bg-white/30")} aria-hidden />
              <span className="font-mono text-[11px] uppercase tracking-[.12em] text-[#8fc7ad]">Пассивный режим · {passive ? "включён" : "выключен"}</span>
            </div>
            <h2 id="passive-h" className="h-serif mt-3 text-[clamp(24px,3vw,34px)] !text-white">
              {agent.searching ? <>Агент ищет за тебя<span className="text-[#7fe3b6]">.</span></>
                : passive ? <>Искать работу не нужно<span className="text-[#7fe3b6]">.</span></>
                : agent.paused ? <>Кампания на паузе<span className="text-[#7fe3b6]">.</span></>
                : running ? <>Поиск вакансий выключен<span className="text-[#7fe3b6]">.</span></>
                : <>Кампании сейчас нет<span className="text-[#7fe3b6]">.</span></>}
            </h2>
            <p className="mt-2 text-[14.5px] text-white/70">
              {agent.searching
                ? "Агент работает в рамках Career Campaign — ищет, готовит и подаёт заявки."
                : passive
                  ? "Агент скажет, когда стоит двигаться: он следит за рынком, Career Score и ролями, где платят заметно больше."
                  : agent.paused
                    ? "Агент не подаёт заявки, пока кампания на паузе. Продолжить можно на странице кампании."
                    : running
                      ? "Кампания идёт, но поиск новых вакансий выключен в настройках Agent."
                      : "Запусти Career Campaign — агент начнёт искать, готовить и подавать заявки. Или включи пассивный режим, если поиск сейчас не нужен."}
            </p>
          </div>
          <div role="group" aria-label="Режим карьеры" className="inline-flex w-fit shrink-0 gap-1 rounded-full border border-white/15 bg-white/[.05] p-1">
            <ModeButton mode="passive" current={passive} icon={<Moon className="size-4" strokeWidth={1.7} aria-hidden />}>Пассивный<span className="hidden sm:inline"> режим</span></ModeButton>
            <ModeButton mode="active" current={!passive} icon={<Rocket className="size-4" strokeWidth={1.7} aria-hidden />}>Активный поиск</ModeButton>
          </div>
        </div>
        <div className="mt-6 flex flex-col gap-3 border-t border-white/10 pt-5 sm:flex-row sm:items-center sm:justify-between">
          {c.currentSalary === 0 ? (
            <p className="text-[14px] text-white/70">Укажи ожидание по зарплате в <Link href="/app/profile#conditions" className="text-white underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-[#7fe3b6]">Career Profile</Link>, чтобы видеть роли, которые платят больше.</p>
          ) : (
            <p className="text-[15px] text-white/85">
              <span className="num text-[26px] leading-none text-[#7fe3b6]">{betterCount}</span>{" "}
              {plural(betterCount, ["вакансия сейчас платит", "вакансии сейчас платят", "вакансий сейчас платят"])} в среднем на 25%+ больше {compWord}
              <span className="text-white/50"> (от {kUsd(threshold)})</span>
            </p>
          )}
          {betterCount > 0 && (
            <a href="#better-roles" className="inline-flex h-10 w-fit shrink-0 items-center gap-2 rounded-full bg-[#7fe3b6] px-5 text-[14px] font-medium text-[#0c1512] transition hover:bg-[#9aeec7] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[#7fe3b6]">
              Посмотреть<ArrowRight className="size-4" strokeWidth={1.8} aria-hidden />
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
            {BREAKDOWN.map(({ key, label }) => {
              const v = c.components[key];
              return (
                <li key={key} className="flex flex-col gap-1.5">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className={cx("text-[14px]", key === rec.key ? "font-medium text-head" : "text-ink-2")}>{label}</span>
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
            <Label>Следующий шаг в карьере</Label>
            {running ? (
              <>
                <h2 className="h-serif text-[clamp(24px,2.6vw,30px)]">Кампания уже <Script>идёт</Script></h2>
                <p className="text-[14px] text-ink-3">{agent.paused ? "Кампания на паузе — продолжить или изменить её можно на странице кампании." : "Прогресс, заявки и интервью — на Today."}</p>
                <ButtonLink href={agent.paused ? "/app/campaign" : "/app"} size="lg" variant="glass" className="w-fit">{agent.paused ? "Открыть кампанию" : "Открыть Today"}<ArrowRight className="size-4" strokeWidth={1.7} aria-hidden /></ButtonLink>
              </>
            ) : (
              <>
                <h2 className="h-serif text-[clamp(24px,2.6vw,30px)]">Пора сделать следующий <Script>шаг</Script>?</h2>
                <p className="text-[14px] text-ink-3">
                  {agent.hasCampaign
                    ? "Новая кампания стартует с текущего Career Profile — опыт и STAR-истории уже на месте, онбординг проходить заново не нужно."
                    : "Кампания стартует с текущего Career Profile: агент ищет роли, готовит заявки и подаёт их в рамках твоих правил."}
                </p>
                <ButtonLink href="/app/campaign" size="lg" className="w-fit"><Rocket className="size-4" strokeWidth={1.7} aria-hidden />{agent.hasCampaign ? "Start Next Campaign" : "Запустить кампанию"}</ButtonLink>
              </>
            )}
            {hiredCampaign && (
              <Link href="/app/hired" className="inline-flex min-h-10 w-fit items-center rounded text-[13px] text-teal underline-offset-4 hover:text-head hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green">
                Итог прошлой кампании · HIRED
              </Link>
            )}
          </Card>
          <nav aria-label="Разделы карьеры" className="grid animate-rise grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2" style={{ animationDelay: "240ms" }}>
            <HubLink href="/app/profile" icon={<UserRound className="size-4" strokeWidth={1.7} aria-hidden />} title="Career Profile" sub="опыт, навыки" />
            <HubLink href="/app/goal" icon={<Target className="size-4" strokeWidth={1.7} aria-hidden />} title="Цель" sub="роль, регионы" />
            <HubLink href="/app/readiness" icon={<Gauge className="size-4" strokeWidth={1.7} aria-hidden />} title="Readiness" sub="интервью" />
            <HubLink href="/app/insights" icon={<Lightbulb className="size-4" strokeWidth={1.7} aria-hidden />} title="Стратегия агента" sub="что приносит ответы" />
          </nav>
        </div>
      </div>

      {/* ── Roles that pay more ────────────────────────────── */}
      <section id="better-roles" aria-labelledby="better-h" className="mt-12 scroll-mt-24">
        <div className="mb-4 flex flex-col gap-1.5">
          <Label>Зарплаты на рынке</Label>
          <h2 id="better-h" className="h-serif text-[clamp(22px,2.4vw,30px)]">Роли, которые платят на 25%+ больше</h2>
          {c.currentSalary > 0 && <p className="text-[14px] text-ink-3">Активные вакансии «{familyLabel}», у которых середина вилки от {usd(threshold)}{betterCount > better.list.length ? ` · показаны ${better.list.length} из ${betterCount}` : ""}.</p>}
        </div>
        {c.currentSalary === 0 ? (
          <Card className="text-[14px] text-ink-3">Нужна текущая компенсация или ожидание в профиле, чтобы сравнить.</Card>
        ) : better.list.length === 0 ? (
          <Card className="text-[14px] text-ink-3">Сейчас нет активных вакансий на 25%+ выше твоей компенсации — ты в верхней части рынка. В пассивном режиме агент сообщит, когда такие появятся.</Card>
        ) : (
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,260px),1fr))] gap-3">
            {better.list.map((jb) => {
              const uplift = Math.round((jb.mid / c.currentSalary - 1) * 100);
              return (
                <li key={jb.id} className="glass flex min-w-0 flex-col gap-3 p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="break-words text-[15px] text-head">{jb.title}</div>
                      <div className="truncate text-[13px] text-ink-3">{jb.company} · {jb.remote === "remote" ? WORK_MODE_RU.remote : placeRu(jb.location) || (WORK_MODE_RU[jb.remote] ?? jb.remote)}</div>
                    </div>
                    <Chip tone="green" className="shrink-0"><span className="sr-only">В среднем </span>+{uplift}%</Chip>
                  </div>
                  <div className="num mt-auto break-words text-[18px] text-head">{jb.salaryMin ? `${usd(jb.salaryMin)}–` : "до "}{usd(jb.salaryMax ?? 0)}</div>
                  {realUrl(jb.url) && (
                    <a href={realUrl(jb.url)!} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-10 w-fit items-center gap-1 rounded text-[13px] text-teal underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green">
                      Вакансия<ArrowUpRight className="size-3.5" strokeWidth={1.7} aria-hidden /><span className="sr-only"> (откроется в новой вкладке)</span>
                    </a>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <Link href="/app/opportunities" className="mt-3 inline-flex min-h-10 items-center gap-1.5 rounded text-[13.5px] text-teal underline-offset-4 hover:text-head hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green">
          <Compass className="size-4" strokeWidth={1.7} aria-hidden />Все возможности
        </Link>
      </section>

      {/* ── History ────────────────────────────────────────── */}
      <Card className="mt-12">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-col gap-1">
            <Label>История Career Score</Label>
            <p className="text-[13px] text-ink-3">Замеры Career Score и Market Value во времени.</p>
          </div>
          <form action={recordSnapshot}>
            <SubmitButton size="sm" variant="glass" pendingText="Фиксируем…" className="!h-10"><Camera className="size-3.5" strokeWidth={1.7} aria-hidden />Зафиксировать сейчас</SubmitButton>
          </form>
        </div>
        {history.length >= 2 ? (
          <HistoryChart points={history} />
        ) : (
          <p className="py-8 text-center text-[14px] text-ink-3">
            Сейчас Career Score — <span className="num text-head">{c.score}</span>. Прошлых замеров пока нет: зафиксируй этот и вернись позже — появится динамика.
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
