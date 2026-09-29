import { ShieldCheck } from "lucide-react";
import { Card, Chip, Label } from "@/components/ui";
import type { GuaranteeView } from "@/lib/engine/guarantee";

/** The public-offer wording of the guarantee — one sentence, reused by the plan picker. */
export const GUARANTEE_PROMISE = "Если за 60 дней кампании не было ни одного приглашения на интервью, кампания продлевается на 30 дней бесплатно — один раз на кампанию.";

const dayMonth = (d: Date | null) => (d ? d.toLocaleDateString("ru-RU", { timeZone: "Asia/Almaty", day: "numeric", month: "long" }) : "конца кампании");

/** «Гарантия интервью» on the running campaign: the promise and where this campaign stands with it. */
export function GuaranteeCard({ view, style }: { view: GuaranteeView; style?: React.CSSProperties }) {
  return (
    <Card className="animate-rise" style={style}>
      <section aria-labelledby="guarantee-h" className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <ShieldCheck className="size-4 shrink-0 text-green" strokeWidth={1.8} aria-hidden />
          <Label><span id="guarantee-h">Гарантия интервью</span></Label>
        </div>
        {view.state === "extended" ? (
          <>
            <Chip tone="green" dot wrap className="self-start">Кампания продлена по гарантии до {dayMonth(view.until)}</Chip>
            <p className="text-[13.5px] text-ink-2">За 60 дней приглашений на интервью не было, поэтому агент работает ещё 30 дней бесплатно. Гарантия действует один раз на кампанию.</p>
          </>
        ) : view.state === "not-needed" ? (
          <>
            <Chip tone="teal" dot wrap className="self-start">Интервью уже есть — гарантия не понадобилась</Chip>
            <p className="text-[13.5px] text-ink-3">{GUARANTEE_PROMISE}</p>
          </>
        ) : (
          <>
            <p className="text-[13.5px] text-ink-2">{GUARANTEE_PROMISE}</p>
            <p className="text-[13.5px] text-head">Если интервью не будет до {dayMonth(view.until)}, продлим на 30 дней.</p>
          </>
        )}
      </section>
    </Card>
  );
}
