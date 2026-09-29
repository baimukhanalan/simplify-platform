import type { Fact, Story } from "@prisma/client";
import { Mic, TrendingUp } from "lucide-react";
import { Card, Chip } from "@/components/ui";
import { j } from "@/lib/db";
import { STORY_TAGS } from "@/lib/ru";
import { getT } from "@/lib/i18n/server";
import { AddStory, EditStory } from "./editors";

/** Story tag keys from one list (lib STORY_TAGS) — the Interview Room's STAR library reads the same; labels: profilePage.tags. */
const isTag = (k: string): k is (typeof STORY_TAGS)[number] => (STORY_TAGS as readonly string[]).includes(k);

export async function Stories({ stories, facts }: { stories: (Story & { fact: Fact | null })[]; facts: Pick<Fact, "id" | "title" | "org">[] }) {
  const t = await getT();
  const tagLabel = (k: string) => (isTag(k) ? t(`profilePage.tags.${k}`) : k);
  const covered = new Set(stories.flatMap((s) => j<string[]>(s.tags, [])));
  const missing = STORY_TAGS.filter((k) => !covered.has(k));
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-3 rounded-2xl border border-teal/15 bg-teal/5 px-4 py-3 text-[13.5px] text-ink-2">
        <Mic className="mt-0.5 size-4 shrink-0 text-teal" strokeWidth={1.7} aria-hidden />
        <p>
          {t.rich("profilePage.stories.intro", {}, { b: (c) => <span className="font-medium text-head">{c}</span> })}
          {missing.length > 0 && <> {t("profilePage.stories.uncovered", { topics: missing.map((k) => tagLabel(k).toLocaleLowerCase(t.locale)).join(", ") })}</>}
        </p>
      </div>

      {stories.length === 0 && (
        <Card className="text-center text-[14px] text-ink-3">{t("profilePage.stories.empty")}</Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {stories.map((s, i) => {
          const tags: string[] = j(s.tags, []);
          return (
            <Card key={s.id} className="flex animate-rise flex-col gap-3" style={{ animationDelay: `${i * 50}ms` }}>
              <div className="flex flex-wrap gap-1.5">
                {tags.map((k) => <Chip key={k} tone="teal">{tagLabel(k)}</Chip>)}
              </div>
              <h3 className="h-serif text-[19px]">{s.title}</h3>
              {s.fact && <div className="label !normal-case !tracking-normal !text-[12px]">{t("profilePage.stories.basedOn", { fact: s.fact.org ? `${s.fact.title} · ${s.fact.org}` : s.fact.title })}</div>}
              <dl className="grid gap-2 text-[13.5px]">
                {([["S", s.situation], ["T", s.task], ["A", s.action], ["R", s.result]] as const).map(([k, v]) => (
                  <div key={k} className="grid grid-cols-[22px_1fr] gap-2">
                    <dt className="num text-teal">{k}</dt>
                    <dd className="text-ink-2">{v}</dd>
                  </div>
                ))}
              </dl>
              {s.metric && (
                <div className="flex items-center gap-2 text-[13.5px] text-green">
                  <TrendingUp className="size-4" strokeWidth={1.7} aria-hidden />{s.metric}
                </div>
              )}
              <div className="mt-auto flex flex-wrap gap-2 pt-1">
                <EditStory facts={facts} story={{ id: s.id, title: s.title, factId: s.factId, situation: s.situation, task: s.task, action: s.action, result: s.result, metric: s.metric, tags }} />
              </div>
            </Card>
          );
        })}
      </div>

      <AddStory facts={facts} />
    </div>
  );
}
