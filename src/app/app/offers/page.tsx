import { Plus } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db, j } from "@/lib/db";
import { ButtonLink, Card, Empty, Label, PageHeader, Script } from "@/components/ui";
import { classifyRole } from "@/lib/engine/taxonomy";
import type { Aggressiveness } from "@/lib/engine/offer";
import { regionsFor } from "@/lib/regions";
import { OfferCard } from "./_components/offer-card";
import { AddOfferForm } from "./_components/offer-forms";

export const metadata = { title: "Offer Desk" };

const LEVELS: Aggressiveness[] = ["soft", "balanced", "assertive"];

export default async function OffersPage({ searchParams }: { searchParams: Promise<{ level?: string }> }) {
  const sp = await searchParams;
  const user = await requireUser();
  const [offers, facts, opps] = await Promise.all([
    db.offer.findMany({ where: { userId: user.id }, orderBy: [{ createdAt: "desc" }] }),
    db.fact.findMany({ where: { userId: user.id, verified: true, NOT: { metrics: "" } }, select: { metrics: true } }),
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
  const strengths = facts.map((f) => f.metrics);
  const open = offers.filter((o) => o.status === "received" || o.status === "negotiating");
  const closed = offers.filter((o) => o.status === "accepted" || o.status === "declined");

  return (
    <>
      <PageHeader
        eyebrow="Offer Desk"
        title={<>Offer <Script>Desk</Script></>}
        sub="Сравните оффер с рынком, получите план переговоров на основе подтверждённых результатов и зафиксируйте итог. Принятие оффера завершает кампанию статусом HIRED."
        actions={<ButtonLink href="#add-offer" variant="glass" size="sm"><Plus className="size-4" strokeWidth={1.7} />Добавить оффер</ButtonLink>}
      />

      {offers.length === 0 ? (
        <Empty title="Офферов пока нет" sub="Когда в Inbox придёт оффер, агент добавит его сюда автоматически. Можно внести оффер и вручную — ниже." />
      ) : (
        <div className="flex flex-col gap-10">
          {[...open, ...closed].map((o) => (
            <OfferCard
              key={o.id}
              offer={o}
              level={level}
              roleFamily={classifyRole(o.role)}
              seniority={seniority}
              regions={regions}
              strengths={strengths}
              name={user.name}
            />
          ))}
        </div>
      )}

      <section id="add-offer" aria-labelledby="add-offer-h" className="mt-10 scroll-mt-24">
        <Card>
          <Label className="mb-2">Вручную</Label>
          <h2 id="add-offer-h" className="h-serif mb-5 text-[26px]">Добавить оффер</h2>
          <AddOfferForm opportunities={opps.map((o) => ({ id: o.id, label: `${o.job.company} — ${o.job.title}` }))} />
        </Card>
      </section>
    </>
  );
}
