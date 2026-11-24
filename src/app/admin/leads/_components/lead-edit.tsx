"use client";
import { useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { adminLeadUpdate } from "@/lib/actions/admin";
import { SubmitButton } from "@/components/client";
import { cx } from "@/components/ui";

const TONE: Record<string, string> = {
  new: "border-green/25 bg-green-soft text-green",
  contacted: "border-teal/20 bg-teal/10 text-teal",
  converted: "border-transparent bg-cta text-white",
  rejected: "border-rose/15 bg-rose-soft text-rose",
};

/** Status picker that saves on change (no extra click). */
export function LeadStatus({ id, status, options }: { id: string; status: string; options: { value: string; label: string }[] }) {
  const ref = useRef<HTMLFormElement>(null);
  const [value, setValue] = useState(status);
  return (
    <form ref={ref} action={adminLeadUpdate} className="relative w-fit">
      <input type="hidden" name="id" value={id} />
      <label className="sr-only" htmlFor={`st-${id}`}>Статус заявки</label>
      <select
        id={`st-${id}`} name="status" value={value}
        onChange={(e) => { setValue(e.target.value); ref.current?.requestSubmit(); }}
        className={cx("h-9 cursor-pointer appearance-none rounded-full border py-0 pl-3.5 pr-8 font-mono text-[11px] uppercase tracking-[.06em] focus-visible:outline-2 focus-visible:outline-green", TONE[value] ?? TONE.new)}
      >
        {options.map((o) => <option key={o.value} value={o.value} className="bg-white text-ink">{o.label}</option>)}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 opacity-70" strokeWidth={1.8} aria-hidden />
    </form>
  );
}

export function LeadNote({ id, note }: { id: string; note: string }) {
  const [value, setValue] = useState(note);
  return (
    <form action={adminLeadUpdate} className="flex flex-col gap-2">
      <input type="hidden" name="id" value={id} />
      <label className="sr-only" htmlFor={`note-${id}`}>Заметка</label>
      <textarea
        id={`note-${id}`} name="adminNote" value={value} onChange={(e) => setValue(e.target.value)} maxLength={2000} rows={2}
        placeholder="Заметка: о чём договорились, когда перезвонить…"
        className="field min-h-[64px] resize-y !py-2 !text-[13.5px]"
      />
      <SubmitButton size="sm" variant="glass" pendingText="Сохраняем…" disabled={value === note} className="self-end">Сохранить заметку</SubmitButton>
    </form>
  );
}
