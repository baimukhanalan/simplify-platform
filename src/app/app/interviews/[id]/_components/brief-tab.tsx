import { ArrowUpRight, Building2, Check, Target } from "lucide-react";
import { Card, Chip, Label, cx } from "@/components/ui";
import { realUrl } from "@/lib/links";
import { aiEnabled } from "@/lib/ai";
import { placeWithFormat } from "../../../../_components/ru";
import { placeRu } from "@/lib/ru";
import { getT } from "@/lib/i18n/server";
import type { T } from "@/lib/i18n/translator";
import { isEnglish, type StoredBrief } from "./brief";
import { DebugLine, RegenerateForm } from "./regenerate-form";

type Props = { id: string; debug?: boolean; brief: StoredBrief; company: string; role: string; skills: string[]; technologies: string[]; jobUrl: string; location: string; remote: string; fictional?: boolean };

const BulletList = ({ items, tone = "teal", lang }: { items: string[]; tone?: "teal" | "green"; lang?: string }) => (
  <ul className="flex flex-col gap-2" lang={lang}>
    {items.map((x) => (
      <li key={x} className="flex gap-2.5 text-[14.5px] leading-relaxed text-ink-2">
        <span aria-hidden className={cx("mt-[9px] size-1.5 shrink-0 rounded-full", tone === "green" ? "bg-green" : "bg-teal/70")} />
        <span>{x}</span>
      </li>
    ))}
  </ul>
);

/**
 * Russian items (the brief is engine/Claude content, stored in Russian) as-is; lines quoted from an English JD are
 * grouped and labelled, never mixed into Russian sentences.
 */
const Bullets = ({ t, items, tone }: { t: T; items: string[]; tone?: "teal" | "green" }) => {
  const ru = items.filter((x) => !isEnglish(x));
  const en = items.filter(isEnglish);
  return (
    <div className="flex flex-col gap-3">
      {ru.length > 0 && <BulletList items={ru} tone={tone} lang={t.locale === "ru" ? undefined : "ru"} />}
      {en.length > 0 && (
        <div className="flex flex-col gap-2">
          {ru.length > 0 && <span className="font-mono text-[11px] uppercase tracking-[.08em] text-ink-3">{t("interviewsPage.brief.quote")}</span>}
          <BulletList items={en} tone={tone} lang="en" />
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

const WORK_FORMATS = ["remote", "hybrid", "onsite"] as const;

/** Place + work format: the Russian line as before; in kk/en the place as the job has it and the format translated. */
function placeLine(t: T, location: string, remote: string) {
  if (t.locale === "ru") return placeWithFormat(placeRu(location), remote.toLowerCase());
  const f = remote.toLowerCase();
  const format = (WORK_FORMATS as readonly string[]).includes(f) ? t(`interviewsPage.brief.workFormat.${f as (typeof WORK_FORMATS)[number]}`) : "";
  const place = location.trim().replace(/\s*\((?:remote|hybrid|on-?site)\)\s*$/i, "");
  if (!format) return place;
  if (!place) return format.charAt(0).toUpperCase() + format.slice(1);
  return place.toLowerCase().includes(format.toLowerCase()) ? place : `${place} · ${format}`;
}

export async function BriefTab({ id, debug, brief, company, role, skills, technologies, jobUrl, location, remote, fictional }: Props) {
  const t = await getT();
  const engine = t.locale === "ru" ? undefined : "ru";
  const place = placeLine(t, location, remote);
  const have = new Set(skills.map((s) => s.toLowerCase()));
  const covered = (req: string) => technologies.some((x) => have.has(x.toLowerCase()) && req.toLowerCase().includes(x.toLowerCase()));
  const gap = (req: string) => technologies.some((x) => !have.has(x.toLowerCase()) && req.toLowerCase().includes(x.toLowerCase()));
  const byClaude = brief.by === "claude";
  const news = `https://news.google.com/search?q=${encodeURIComponent(`"${company}"`)}`;

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-[13.5px] text-ink-3">
          {t("interviewsPage.brief.intro")}
          <span className="ml-2 inline-flex align-middle"><Chip tone={byClaude ? "green" : "neutral"}>{byClaude ? "Claude" : t("interviewsPage.brief.byEngine")}</Chip></span>
        </p>
        <RegenerateForm id={id} aiOn={aiEnabled()} by={brief.by} stamp={brief.at} pendingText={t("interviewsPage.brief.pending")} />
      </div>
      {debug && <DebugLine>brief: {brief.by ?? "engine"}{brief.at ? ` · ${brief.at}` : ` · ${t("interviewsPage.brief.notSaved")}`} · ai={aiEnabled() ? "on" : "off"}</DebugLine>}

      <Card strong className="flex flex-col gap-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-1.5">
            <span className="flex items-center gap-2"><Building2 className="size-4 text-teal" strokeWidth={1.7} aria-hidden /><Label>{t("interviewsPage.brief.aboutCompany")}</Label></span>
            <h2 className="h-serif text-[clamp(24px,2.6vw,32px)]">{company}</h2>
          </div>
          {realUrl(jobUrl) && (
            <a href={realUrl(jobUrl)!} target="_blank" rel="noreferrer" className="inline-flex min-h-10 shrink-0 items-center gap-1 rounded text-[13px] text-teal underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-green">
              {t("interviewsPage.brief.vacancy")}<ArrowUpRight className="size-3.5" strokeWidth={1.7} aria-hidden /><span className="sr-only">{t("interviewsPage.brief.newTab")}</span>
            </a>
          )}
        </div>
        <p lang={isEnglish(brief.company.what) ? "en" : engine} className="max-w-3xl text-[16px] leading-relaxed text-head">{brief.company.what}</p>
        <div className="grid gap-6 border-t border-line pt-5 md:grid-cols-2">
          <Block label={t("interviewsPage.brief.model")}>
            <p lang={isEnglish(brief.company.model) ? "en" : engine} className="text-[14.5px] leading-relaxed text-ink-2">{brief.company.model}</p>
          </Block>
          <Block label={t("interviewsPage.brief.products")}>
            {brief.company.products.length ? <Bullets t={t} items={brief.company.products} /> : <p className="text-[14px] text-ink-3">{t("interviewsPage.brief.noProducts")}</p>}
          </Block>
        </div>
        {/* No outside research for a company of the internal corpus: there is nothing to find in the news. */}
        {!fictional && (
        <div className="rounded-2xl border border-line bg-white/55 p-4">
          <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
            <Label>{byClaude ? t("interviewsPage.brief.recent") : t("interviewsPage.brief.recentCheck")}</Label>
            <a href={news} target="_blank" rel="noreferrer" className="inline-flex min-h-10 items-center gap-1 rounded text-[12.5px] text-teal underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-green">
              {t("interviewsPage.brief.news", { company })}<ArrowUpRight className="size-3.5" strokeWidth={1.7} aria-hidden /><span className="sr-only">{t("interviewsPage.brief.newsNewTab")}</span>
            </a>
          </div>
          <Bullets t={t} items={brief.company.recent} />
        </div>
        )}
      </Card>

      <Card className="flex flex-col gap-6">
        <div className="flex flex-col gap-1.5">
          <span className="flex items-center gap-2"><Target className="size-4 text-teal" strokeWidth={1.7} aria-hidden /><Label>{t("interviewsPage.brief.aboutRole")}</Label></span>
          <h2 className="h-serif text-[clamp(22px,2.4vw,28px)]">{role}</h2>
          <p className="text-[13px] text-ink-3">{place}</p>
        </div>
        <div className="grid gap-6 md:grid-cols-2">
          <Block label={t("interviewsPage.brief.lookFor")}>
            <Bullets t={t} items={brief.role.lookFor} tone="green" />
          </Block>
          <Block label={t("interviewsPage.brief.responsibilities")}>
            <Bullets t={t} items={brief.role.responsibilities} />
          </Block>
        </div>
        <div className="grid gap-6 border-t border-line pt-5 md:grid-cols-2">
          <Block label={brief.role.requirements.every(isEnglish) ? t("interviewsPage.brief.requirementsFromJd") : t("interviewsPage.brief.requirements")}>
            <ul className="flex flex-col gap-2">
              {brief.role.requirements.map((r) => {
                const ok = covered(r);
                const miss = !ok && gap(r);
                return (
                  <li key={r} className="flex gap-2.5 text-[14px] leading-relaxed text-ink-2" lang={isEnglish(r) ? "en" : engine}>
                    {ok ? (
                      <Check className="mt-1 size-3.5 shrink-0 text-green" strokeWidth={2.2} aria-label={t("interviewsPage.brief.inProfile")} lang={t.locale} />
                    ) : (
                      <span aria-hidden className={cx("mt-[8px] size-1.5 shrink-0 rounded-full", miss ? "bg-amber" : "bg-teal/50")} />
                    )}
                    <span>
                      {r}
                      {miss && <>{" "}<span lang={t.locale} className="whitespace-nowrap text-[12px] text-amber">{t("interviewsPage.brief.toPrepare")}</span></>}
                    </span>
                  </li>
                );
              })}
            </ul>
          </Block>
          <Block label={t("interviewsPage.brief.topics")}>
            <ol className="flex flex-col gap-2">
              {brief.role.topics.map((topic, i) => (
                <li key={topic} lang={isEnglish(topic) ? "en" : engine} className="flex gap-3 text-[14px] leading-relaxed text-ink-2">
                  <span className="num w-4 shrink-0 text-ink-4">{i + 1}</span>
                  {topic}
                </li>
              ))}
            </ol>
          </Block>
        </div>
      </Card>
    </div>
  );
}
