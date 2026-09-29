import { Plus } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db, j } from "@/lib/db";
import { ButtonLink, Card, Empty, Label, PageHeader, Script } from "@/components/ui";
import { classifyRole } from "@/lib/engine/taxonomy";
import type { Aggressiveness } from "@/lib/engine/offer";
import { regionsFor } from "@/lib/regions";
import { OfferDesk } from "./_components/offer-desk";
import { ClosedOffer } from "./_components/closed-offer";
import { AddOfferForm } from "./_components/offer-forms";

export const metadata = { title: "Offer Desk" };

const LEVELS: Aggressiveness[] = ["soft", "balanced", "assertive"];

export default async function OffersPage({ searchParams }: { searchParams: Promise<{ level?: string }> }) {
  const [sp, user] = await Promise.all([searchParams, requireUser()]);
  const [offers, facts, opps] = await Promise.all([
    db.offer.findMany({ where: { userId: user.id }, orderBy: [{ createdAt: "desc" }] }),
    db.fact.findMany({ where: { userId: user.id, verified: true, NOT: { metrics: "" } }, select: { metrics: true, kind: true }, orderBy: { createdAt: "asc" } }),
    db.opportunity.findMany({
      where: { campaign: { userId: user.id }, status: { in: ["recruiter", "hiring_manager", "technical", "final", "offer"] } },
      include: { job: { select: { company: true, title: true } } },
      orderBy: { updatedAt: "desc" },
      take: 30,
    }),
  ]);
  const level: Aggressiveness = LEVELS.includes(sp.level as Aggressiveness) ? (sp.level as Aggressiveness) : "balanced";
  const seniority = user.goal?.seniority ?? "junior";
  const regions = regionsFor(j<string[]>(user.goal?.countries, []));
  // Only the user's own verified results; work experience first, CV order within (most recent role first).
  const strengths = [...facts.filter((f) => f.kind === "employment"), ...facts.filter((f) => f.kind !== "employment")].map((f) => f.metrics);
  const open = offers.filter((o) => o.status === "received" || o.status === "negotiating");
  const closed = offers.filter((o) => o.status === "accepted" || o.status === "declined");
  const oppOptions = opps.map((o) => ({ id: o.id, label: `${o.job.company} — ${o.job.title}` }));

  return (
    <>
      {open.length === 0 && (
        <PageHeader
          eyebrow="Offer Desk"
          title={<>Offer <Script>Desk</Script></>}
          sub="Когда придёт оффер, здесь появятся разбор компенсации, сравнение с рынком и Negotiation Assistant."
          actions={<ButtonLink href="#add-offer" variant="glass" size="sm" className="!h-10"><Plus className="size-4" strokeWidth={1.7} aria-hidden />Добавить оффер</ButtonLink>}
        />
      )}
      {open.length > 0 && <h1 className="sr-only">Offer Desk</h1>}

      {offers.length === 0 ? (
        <Empty title="Офферов пока нет" sub="Агент добавит оффер сюда автоматически, как только он придёт во входящие. Оффер пришёл напрямую — внеси его ниже." />
      ) : (
        <div className="flex flex-col gap-14">
          {open.map((o) => (
            <OfferDesk
              key={o.id}
              offer={o}
              level={level}
              roleFamily={classifyRole(o.role)}
              seniority={seniority}
              regions={regions}
              strengths={strengths}
              name={user.name}
              minimum={user.goal?.minSalary ? { amount: user.goal.minSalary, currency: user.goal.currency } : undefined}
            />
          ))}
          {closed.length > 0 && (
            <section aria-labelledby="closed-h">
              <Label className="mb-3"><span id="closed-h">История офферов</span></Label>
              <ul className="flex flex-col gap-2">{closed.map((o) => <ClosedOffer key={o.id} offer={o} />)}</ul>
            </section>
          )}
        </div>
      )}

      <section id="add-offer" aria-labelledby="add-offer-h" className="mt-12 scroll-mt-24">
        {offers.length > 0 ? (
          <details className="glass group p-5 sm:p-6">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-xl focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-green [&::-webkit-details-marker]:hidden">
              <span className="flex flex-col gap-1">
                <span className="label">Вручную</span>
                <span id="add-offer-h" className="h-serif text-[22px]">Добавить ещё оффер</span>
              </span>
              <Plus className="size-5 shrink-0 text-teal transition-transform group-open:rotate-45" strokeWidth={1.7} aria-hidden />
            </summary>
            <div className="mt-5"><AddOfferForm opportunities={oppOptions} /></div>
          </details>
        ) : (
          <Card>
            <Label className="mb-2">Вручную</Label>
            <h2 id="add-offer-h" className="h-serif mb-5 text-[26px]">Добавить оффер</h2>
            <AddOfferForm opportunities={oppOptions} />
          </Card>
        )}
      </section>
    </>
  );
}
