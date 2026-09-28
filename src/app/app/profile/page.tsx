import type { Metadata } from "next";
import { Gauge } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db, j } from "@/lib/db";
import { ButtonLink, Card, Empty, PageHeader, Script, Stat } from "@/components/ui";
import { SectionTitle } from "./_components/bits";
import { IdentityForm, ConditionsForm, SkillsEditor, CvSection } from "./_components/sections";
import { FactsList } from "./_components/facts";
import { Stories } from "./_components/stories";

export const metadata: Metadata = { title: "Career Profile" };

const NAV = [
  ["contacts", "Контакты"],
  ["conditions", "Условия"],
  ["skills", "Навыки"],
  ["facts", "Опыт"],
  ["stories", "STAR"],
  ["cv", "CV"],
] as const;

export default async function ProfilePage() {
  const user = await requireUser();
  const [profile, facts, stories] = await Promise.all([
    db.profile.findUnique({ where: { userId: user.id } }),
    db.fact.findMany({ where: { userId: user.id }, orderBy: { createdAt: "asc" }, include: { miniAnswers: { where: { userId: user.id }, orderBy: { createdAt: "asc" } } } }),
    db.story.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, include: { fact: true } }),
  ]);

  if (!profile) {
    return (
      <>
        <PageHeader eyebrow="Career Profile" title={<>Ваш Career <Script>Profile</Script></>} />
        <Empty title="Профиль ещё не создан" sub="Загрузите CV — Simplify извлечёт опыт, навыки и достижения." action={<ButtonLink href="/onboarding">Загрузить CV</ButtonLink>} />
      </>
    );
  }

  const verified = facts.filter((f) => f.verified).length;
  const withMetrics = facts.filter((f) => f.metrics).length;
  const skills = j<string[]>(profile.skills, []);

  return (
    <>
      <PageHeader
        eyebrow="Career Profile"
        title={<>Ваш Career <Script>Profile</Script></>}
        sub="Единственный источник правды для агента. Всё, что Simplify пишет в CV, анкетах и на интервью, опирается только на подтверждённые факты отсюда."
        actions={<ButtonLink href="/app/readiness" variant="glass"><Gauge className="size-4" strokeWidth={1.7} aria-hidden />Проверить Readiness</ButtonLink>}
      />

      <Card className="mb-6 grid animate-rise grid-cols-2 gap-6 sm:grid-cols-4" style={{ animationDelay: "60ms" }}>
        <Stat label="Фактов" value={facts.length} />
        <Stat label="Verified" value={`${facts.length ? Math.round((verified / facts.length) * 100) : 0}%`} hint={`${verified} из ${facts.length}`} tone={verified === facts.length && facts.length ? "green" : undefined} />
        <Stat label="С метрикой" value={withMetrics} hint="было → стало" />
        <Stat label="STAR-историй" value={stories.length} hint="для Interview Copilot" />
      </Card>

      <nav aria-label="Разделы профиля" className="scroll-thin -mx-4 mb-8 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
        {NAV.map(([id, label]) => (
          <a key={id} href={`#${id}`} className="glass shrink-0 !rounded-full px-3.5 py-1.5 font-mono text-[11px] uppercase tracking-[.06em] text-ink-2 transition-colors hover:bg-white hover:text-head focus-visible:outline-2 focus-visible:outline-green">
            {label}
          </a>
        ))}
      </nav>

      <div className="flex flex-col gap-12">
        <section aria-labelledby="contacts-h">
          <SectionTitle id="contacts" eyebrow="01 · Identity" title={<span id="contacts-h">Контакты и ссылки</span>} />
          <IdentityForm name={user.name} email={user.email} profile={profile} />
        </section>

        <section aria-labelledby="conditions-h">
          <SectionTitle id="conditions" eyebrow="02 · Eligibility" title={<span id="conditions-h">Право на работу и условия</span>} sub="Используется в Eligibility-проверке: вакансии, где вы юридически не можете работать, блокируются до подачи." />
          <ConditionsForm profile={profile} />
        </section>

        <section aria-labelledby="skills-h">
          <SectionTitle id="skills" eyebrow="03 · Skills" title={<span id="skills-h">Навыки</span>} sub="Навык с зелёной отметкой встречается в вашем опыте — агент ставит такие навыки выше." />
          <SkillsEditor skills={skills} facts={facts} />
        </section>

        <section aria-labelledby="facts-h" className="flex flex-col gap-5">
          <SectionTitle id="facts" eyebrow="04 · Опыт" title={<span id="facts-h">Опыт и <Script>достижения</Script></span>} sub="Работа, образование, проекты и сертификаты — из них агент собирает CV под каждую вакансию." />
          <FactsList facts={facts} />
        </section>

        <section aria-labelledby="stories-h">
          <SectionTitle id="stories" eyebrow="05 · Interview material" title={<span id="stories-h">STAR-истории</span>} sub="Situation, Task, Action, Result — короткие истории из вашего реального опыта для behavioral-вопросов." />
          <Stories stories={stories} facts={facts.map((f) => ({ id: f.id, title: f.title, org: f.org }))} />
        </section>

        <section aria-labelledby="cv-h">
          <SectionTitle id="cv" eyebrow="06 · Source" title={<span id="cv-h">CV</span>} />
          <CvSection profile={profile} />
        </section>
      </div>
    </>
  );
}
