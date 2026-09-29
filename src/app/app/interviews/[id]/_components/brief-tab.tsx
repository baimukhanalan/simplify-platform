import { ArrowUpRight, Building2, Check, Target } from "lucide-react";
import { Card, Chip, Label, cx } from "@/components/ui";
import { realUrl } from "@/lib/links";
import { aiEnabled } from "@/lib/ai";
import { placeWithFormat } from "../../../../_components/ru";
import { placeRu } from "@/lib/ru";
import { isEnglish, type StoredBrief } from "./brief";
import { DebugLine, RegenerateForm } from "./regenerate-form";

type Props = { id: string; debug?: boolean; brief: StoredBrief; company: string; role: string; skills: string[]; technologies: string[]; jobUrl: string; location: string; remote: string };

const BulletList = ({ items, tone = "teal", en }: { items: string[]; tone?: "teal" | "green"; en?: boolean }) => (
  <ul className="flex flex-col gap-2" lang={en ? "en" : undefined}>
    {items.map((x) => (
      <li key={x} className="flex gap-2.5 text-[14.5px] leading-relaxed text-ink-2">
        <span aria-hidden className={cx("mt-[9px] size-1.5 shrink-0 rounded-full", tone === "green" ? "bg-green" : "bg-teal/70")} />
        <span>{x}</span>
      </li>
    ))}
  </ul>
);

/** Russian items as-is; lines quoted from an English JD are grouped and labelled, never mixed into Russian sentences. */
const Bullets = ({ items, tone }: { items: string[]; tone?: "teal" | "green" }) => {
  const ru = items.filter((x) => !isEnglish(x));
  const en = items.filter(isEnglish);
  return (
    <div className="flex flex-col gap-3">
      {ru.length > 0 && <BulletList items={ru} tone={tone} />}
      {en.length > 0 && (
        <div className="flex flex-col gap-2">
          {ru.length > 0 && <span className="font-mono text-[11px] uppercase tracking-[.08em] text-ink-3">Цитата из вакансии</span>}
          <BulletList items={en} tone={tone} en />
        </div>
      )}
    </div>
  );
};

function Block({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

export function BriefTab({ id, debug, brief, company, role, skills, technologies, jobUrl, location, remote }: Props) {
  const have = new Set(skills.map((s) => s.toLowerCase()));
  const covered = (req: string) => technologies.some((t) => have.has(t.toLowerCase()) && req.toLowerCase().includes(t.toLowerCase()));
  const gap = (req: string) => technologies.some((t) => !have.has(t.toLowerCase()) && req.toLowerCase().includes(t.toLowerCase()));
  const byClaude = brief.by === "claude";
  const news = `https://news.google.com/search?q=${encodeURIComponent(`"${company}"`)}`;

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-[13.5px] text-ink-3">
          Коротко о компании и роли — прочитать за 3 минуты перед звонком.
          <span className="ml-2 inline-flex align-middle"><Chip tone={byClaude ? "green" : "neutral"}>{byClaude ? "Claude" : "из вакансии"}</Chip></span>
        </p>
        <RegenerateForm id={id} aiOn={aiEnabled()} by={brief.by} stamp={brief.at} pendingText="Claude собирает обзор…" />
      </div>
      {debug && <DebugLine>brief: {brief.by ?? "engine"}{brief.at ? ` · ${brief.at}` : " · не сохранён"} · ai={aiEnabled() ? "on" : "off"}</DebugLine>}

      <Card strong className="flex flex-col gap-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-1.5">
            <span className="flex items-center gap-2"><Building2 className="size-4 text-teal" strokeWidth={1.7} aria-hidden /><Label>О компании</Label></span>
            <h2 className="h-serif text-[clamp(24px,2.6vw,32px)]">{company}</h2>
          </div>
          {realUrl(jobUrl) && (
            <a href={realUrl(jobUrl)!} target="_blank" rel="noreferrer" className="inline-flex min-h-10 shrink-0 items-center gap-1 rounded text-[13px] text-teal underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-green">
              Вакансия<ArrowUpRight className="size-3.5" strokeWidth={1.7} aria-hidden /><span className="sr-only">(в новой вкладке)</span>
            </a>
          )}
        </div>
        <p className="max-w-3xl text-[16px] leading-relaxed text-head">{brief.company.what}</p>
        <div className="grid gap-6 border-t border-line pt-5 md:grid-cols-2">
          <Block label="Бизнес-модель">
            <p className="text-[14.5px] leading-relaxed text-ink-2">{brief.company.model}</p>
          </Block>
          <Block label="Продукты">
            {brief.company.products.length ? <Bullets items={brief.company.products} /> : <p className="text-[14px] text-ink-3">Продукты в вакансии не названы.</p>}
          </Block>
        </div>
        <div className="rounded-2xl border border-line bg-white/55 p-4">
          <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
            <Label>{byClaude ? "Последние события" : "Последние события · проверь перед звонком"}</Label>
            <a href={news} target="_blank" rel="noreferrer" className="inline-flex min-h-10 items-center gap-1 rounded text-[12.5px] text-teal underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-green">
              Новости {company}<ArrowUpRight className="size-3.5" strokeWidth={1.7} aria-hidden /><span className="sr-only">(Google News, в новой вкладке)</span>
            </a>
          </div>
          <Bullets items={brief.company.recent} />
        </div>
      </Card>

      <Card className="flex flex-col gap-6">
        <div className="flex flex-col gap-1.5">
          <span className="flex items-center gap-2"><Target className="size-4 text-teal" strokeWidth={1.7} aria-hidden /><Label>О роли</Label></span>
          <h2 className="h-serif text-[clamp(22px,2.4vw,28px)]">{role}</h2>
          <p className="text-[13px] text-ink-3">{placeWithFormat(placeRu(location), remote.toLowerCase())}</p>
        </div>
        <div className="grid gap-6 md:grid-cols-2">
          <Block label="Кого ищут">
            <Bullets items={brief.role.lookFor} tone="green" />
          </Block>
          <Block label="Основные задачи">
            <Bullets items={brief.role.responsibilities} />
          </Block>
        </div>
        <div className="grid gap-6 border-t border-line pt-5 md:grid-cols-2">
          <Block label={brief.role.requirements.every(isEnglish) ? "Ключевые требования · из вакансии" : "Ключевые требования"}>
            <ul className="flex flex-col gap-2">
              {brief.role.requirements.map((r) => {
                const ok = covered(r);
                const miss = !ok && gap(r);
                return (
                  <li key={r} className="flex gap-2.5 text-[14px] leading-relaxed text-ink-2" lang={isEnglish(r) ? "en" : undefined}>
                    {ok ? (
                      <Check className="mt-1 size-3.5 shrink-0 text-green" strokeWidth={2.2} aria-label="есть в профиле" />
                    ) : (
                      <span aria-hidden className={cx("mt-[8px] size-1.5 shrink-0 rounded-full", miss ? "bg-amber" : "bg-teal/50")} />
                    )}
                    <span>
                      {r}
                      {miss && <>{" "}<span lang="ru" className="whitespace-nowrap text-[12px] text-amber">· подготовить</span></>}
                    </span>
                  </li>
                );
              })}
            </ul>
          </Block>
          <Block label="Вероятные темы интервью">
            <ol className="flex flex-col gap-2">
              {brief.role.topics.map((t, i) => (
                <li key={t} className="flex gap-3 text-[14px] leading-relaxed text-ink-2">
                  <span className="num w-4 shrink-0 text-ink-4">{i + 1}</span>
                  {t}
                </li>
              ))}
            </ol>
          </Block>
        </div>
      </Card>
    </div>
  );
}
