import { Sparkles, Lock, AlertTriangle } from "lucide-react";
import { Card, Chip, Empty, Label } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { regeneratePack } from "@/lib/actions/interview";
import { aiEnabled } from "@/lib/ai";
import type { Pack } from "@/lib/engine/interview";
import { ROUND_LABEL } from "@/lib/rounds";

const Lines = ({ text }: { text: string }) => (
  <ul className="flex flex-col gap-2">
    {text.split("\n").map((l) => l.trim()).filter(Boolean).map((l, i) => {
      const m = l.match(/^([A-Za-zА-Яа-я ]{1,14}):\s*(.*)$/);
      return (
        <li key={i} className="flex gap-3 text-[14.5px] leading-relaxed text-ink-2">
          {m ? <span className="label mt-[5px] w-[74px] shrink-0 !text-[10px] !text-teal">{m[1]}</span> : <span aria-hidden className="mt-2.5 size-1 shrink-0 rounded-full bg-teal" />}
          <span>{m ? m[2] : l}</span>
        </li>
      );
    })}
  </ul>
);

export function PackTab({ id, pack, round }: { id: string; pack: (Pack & { generatedBy?: string; generatedAt?: string }) | null; round: string }) {
  const by = pack?.generatedBy === "claude" ? "claude" : "engine";
  const regenerate = (
    <form action={regeneratePack}>
      <input type="hidden" name="id" value={id} />
      <SubmitButton size="sm" variant="primary" pendingText={aiEnabled() ? "Claude готовит пакет…" : "Обновляем…"}>
        <Sparkles className="size-3.5" strokeWidth={1.7} />Обновить с AI
      </SubmitButton>
    </form>
  );
  if (!pack || !pack.tellMeAboutYourself) return <Empty title="Interview Pack ещё не собран" sub="Соберём его из вашего Truth Layer и описания вакансии." action={regenerate} />;

  return (
    <div className="flex flex-col gap-4">
      <div className="glass flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2 text-[13px] text-ink-3">
          <Chip tone={by === "claude" ? "green" : "teal"}>{by === "claude" ? "Сгенерировано Claude" : "Сгенерировано engine"}</Chip>
          <span>Раунд: {ROUND_LABEL[round] ?? round}</span>
          {pack.generatedAt && <span>· {new Date(pack.generatedAt).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>}
          {!aiEnabled() && <span className="basis-full text-[12px] text-ink-4">AI-ключ не настроен — пакет собирает детерминированный engine из ваших фактов.</span>}
        </div>
        {regenerate}
      </div>

      <div className="flex items-start gap-2.5 rounded-2xl border border-green/15 bg-green-soft/60 px-4 py-3 text-[13px] text-green">
        <Lock className="mt-0.5 size-4 shrink-0" strokeWidth={1.7} />
        Truth Lock: behavioral-ответы собраны только из подтверждённых STAR-историй. Ничего не придумано.
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="lg:col-span-2">
          <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="h-serif text-[24px]">Tell me about yourself</h2>
            <Chip>60–90 сек</Chip>
          </div>
          <Lines text={pack.tellMeAboutYourself} />
        </Card>
        <Card>
          <h2 className="h-serif mb-3 text-[22px]">Why our company</h2>
          <Lines text={pack.whyCompany} />
        </Card>
        <Card>
          <h2 className="h-serif mb-3 text-[22px]">Why this role</h2>
          <Lines text={pack.whyRole} />
        </Card>
      </div>

      <Card>
        <h2 className="h-serif mb-1 text-[24px]">Behavioral · STAR</h2>
        <p className="mb-4 text-[13px] text-ink-3">Вопрос → ваша подтверждённая история → структура ответа.</p>
        <div className="flex flex-col divide-y divide-line">
          {pack.behavioral.map((b) => {
            const missing = /Добавьте|Нет подходящей/.test(b.storyTitle + b.outline);
            return (
              <details key={b.question} className="group py-3 first:pt-0 last:pb-0">
                <summary className="flex cursor-pointer list-none items-start justify-between gap-3 rounded-lg focus-visible:outline-2 focus-visible:outline-green [&::-webkit-details-marker]:hidden">
                  <span className="flex flex-col gap-1">
                    <span className="text-[15px] font-medium text-head">{b.question}</span>
                    <span className={missing ? "text-[13px] text-amber" : "text-[13px] text-teal"}>{missing ? "Нет подтверждённой истории" : `История: ${b.storyTitle}`}</span>
                  </span>
                  <span aria-hidden className="mt-1 text-ink-4 transition-transform group-open:rotate-45">+</span>
                </summary>
                <div className="mt-3 pl-0 sm:pl-2"><Lines text={b.outline} /></div>
              </details>
            );
          })}
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="h-serif mb-4 text-[22px]">Technical topics</h2>
          <ul className="flex flex-col gap-3">
            {pack.technicalTopics.map((t) => (
              <li key={t.topic} className="flex flex-col gap-0.5">
                <span className="text-[14.5px] font-medium text-head">{t.topic}</span>
                <span className="text-[13px] text-ink-3">{t.why} · {t.prep}</span>
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <h2 className="h-serif mb-4 text-[22px]">Questions to ask</h2>
          <ol className="flex flex-col gap-2.5">
            {pack.questionsToAsk.slice(0, 10).map((q, i) => (
              <li key={q} className="flex gap-3 text-[14.5px] text-ink-2">
                <span className="num w-5 shrink-0 text-ink-4">{i + 1}</span>{q}
              </li>
            ))}
          </ol>
        </Card>
      </div>

      {pack.redFlags.length > 0 && (
        <Card className="!border-amber/20">
          <div className="mb-3 flex items-center gap-2"><AlertTriangle className="size-4 text-amber" strokeWidth={1.7} /><Label className="!text-amber">Red flags — чего избегать</Label></div>
          <ul className="flex flex-col gap-2">
            {pack.redFlags.map((r) => <li key={r} className="flex gap-2 text-[14px] text-ink-2"><span aria-hidden className="mt-2 size-1 shrink-0 rounded-full bg-amber" />{r}</li>)}
          </ul>
        </Card>
      )}
    </div>
  );
}
