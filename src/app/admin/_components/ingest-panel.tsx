"use client";
import { useActionState } from "react";
import { DownloadCloud } from "lucide-react";
import { Field } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { adminIngest, type IngestState } from "@/lib/actions/admin";

export function IngestPanel() {
  const [state, action] = useActionState<IngestState, FormData>(adminIngest, undefined);
  return (
    <div className="flex flex-col gap-4">
      <form action={action} className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <Field label="Поисковый запрос (необязательно)" className="flex-1" hint="Применяется к источникам с поиском (Remotive, Jobicy)">
          <input name="q" maxLength={60} className="field" placeholder="data analyst" />
        </Field>
        <SubmitButton pendingText="Загружаем из источников…" className="sm:mb-[22px]">
          <DownloadCloud className="size-4" strokeWidth={1.7} />Загрузить живые вакансии
        </SubmitButton>
      </form>
      <div aria-live="polite">
        {state?.error && <p role="alert" className="rounded-xl bg-rose-soft px-3 py-2 text-[13.5px] text-rose">{state.error}</p>}
        {state?.report && (
          <div className="rounded-2xl border border-line bg-white/60 p-4">
            <div className="label mb-3 !text-[11px]">Отчёт · {new Date(state.at!).toLocaleTimeString("ru-RU", { timeZone: "Asia/Almaty" })}</div>
            <ul className="grid gap-2 sm:grid-cols-2">
              {Object.entries(state.report).map(([src, v]) => (
                <li key={src} className="flex flex-col gap-0.5 text-[13.5px]">
                  <span className="flex items-baseline justify-between gap-3">
                    <span className="font-mono text-[12px] text-head">{src}{v.boards && <span className="text-ink-4"> · досок {v.boards}</span>}</span>
                    <span className="num text-green">+{v.added} новых</span>
                  </span>
                  <span className="num text-[12px] text-ink-3">
                    получено {v.fetched} · доступно из KZ {v.kzOpen}{v.retired ? ` · в архив ${v.retired}` : ""}
                  </span>
                  {v.errors.length > 0 && (
                    <span className="truncate text-[12px] text-rose" title={v.errors.join("\n")}>
                      {v.errors.length === 1 ? v.errors[0] : `${v.errors.length} ошибок: ${v.errors[0]}`}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
