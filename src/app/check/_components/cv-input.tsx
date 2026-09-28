"use client";
import { useId, useRef, useState, type DragEvent } from "react";
import { FileText, UploadCloud, X, AlertCircle, CheckCircle2 } from "lucide-react";
import { cx } from "@/components/ui";

type Status = { kind: "idle" } | { kind: "uploading"; name: string } | { kind: "done"; name: string; pages: number } | { kind: "error"; message: string };

/**
 * CV source picker: PDF/TXT upload (parsed server-side via /api/cv/parse) or pasted text.
 * Always submits the final text as a hidden `cvText` field (+ `cvFileName`).
 */
export function CvInput({ initialText = "", initialFileName = "", minChars = 120, onTextChange }: { initialText?: string; initialFileName?: string; minChars?: number; onTextChange?: (text: string) => void }) {
  const [tab, setTab] = useState<"upload" | "paste">(initialText && !initialFileName ? "paste" : "upload");
  const [text, setTextState] = useState(initialText);
  const [fileName, setFileName] = useState(initialFileName);
  const [status, setStatus] = useState<Status>(initialFileName && initialText ? { kind: "done", name: initialFileName, pages: 0 } : { kind: "idle" });
  const [drag, setDrag] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const id = useId();
  const setText = (t: string) => { setTextState(t); onTextChange?.(t); };

  async function upload(file: File) {
    if (file.size > 5 * 1024 * 1024) return setStatus({ kind: "error", message: "Файл больше 5 МБ" });
    if (!/\.(pdf|txt)$/i.test(file.name) && !["application/pdf", "text/plain"].includes(file.type)) return setStatus({ kind: "error", message: "Поддерживаются только PDF и TXT" });
    setStatus({ kind: "uploading", name: file.name });
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/cv/parse", { method: "POST", body: fd });
      const data = (await res.json().catch(() => ({}))) as { text?: string; pages?: number; fileName?: string; error?: string };
      if (!res.ok || !data.text) throw new Error(data.error || "Не удалось прочитать файл");
      setText(data.text);
      setFileName(data.fileName || file.name);
      setStatus({ kind: "done", name: data.fileName || file.name, pages: data.pages ?? 1 });
    } catch (e) {
      setStatus({ kind: "error", message: e instanceof Error ? e.message : "Не удалось прочитать файл" });
    } finally {
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDrag(false);
    const f = e.dataTransfer.files?.[0];
    if (f) void upload(f);
  };
  const clear = () => { setText(""); setFileName(""); setStatus({ kind: "idle" }); };
  const chars = text.trim().length;

  return (
    <div className="flex flex-col gap-3">
      <input type="hidden" name="cvText" value={text} />
      <input type="hidden" name="cvFileName" value={fileName} />

      <div role="group" aria-label="Источник CV" className="inline-flex w-fit rounded-full border border-line bg-white/60 p-1">
        {(["upload", "paste"] as const).map((t) => (
          <button
            key={t}
            type="button"
            aria-pressed={tab === t}
            aria-controls={`${id}-panel-${t}`}
            onClick={() => setTab(t)}
            className={cx("rounded-full px-4 py-1.5 text-[13px] transition-colors focus-visible:outline-2 focus-visible:outline-green", tab === t ? "bg-cta text-white shadow-(--shadow-cta)" : "text-ink-2 hover:text-head")}
          >
            {t === "upload" ? "Загрузить файл" : "Вставить текст"}
          </button>
        ))}
      </div>

      <div id={`${id}-panel-upload`} hidden={tab !== "upload"}>
        {status.kind === "done" ? (
          <div className="flex items-center gap-3 rounded-2xl border border-green/20 bg-green-soft/60 p-4 animate-fade">
            <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-white text-green"><FileText className="size-5" strokeWidth={1.7} /></div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[14px] font-medium text-head">{status.name}</div>
              <div className="text-[12.5px] text-ink-3">
                <CheckCircle2 className="-mt-0.5 mr-1 inline size-3.5 text-green" strokeWidth={2} />
                Текст извлечён · <span className="num">{chars.toLocaleString("ru-RU")}</span> символов{status.pages ? ` · ${status.pages} стр.` : ""}
                {" · "}
                <button type="button" onClick={() => setTab("paste")} className="underline decoration-line underline-offset-2 hover:text-head">проверить текст</button>
              </div>
            </div>
            <button type="button" onClick={clear} aria-label="Удалить файл" className="grid size-9 shrink-0 place-items-center rounded-full text-ink-3 hover:bg-white hover:text-head focus-visible:outline-2 focus-visible:outline-green"><X className="size-4" /></button>
          </div>
        ) : (
          <label
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={onDrop}
            className={cx(
              "group relative flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border border-dashed px-5 py-9 text-center transition-all has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-green",
              drag ? "border-green bg-green-soft/70" : "border-line bg-white/55 hover:border-teal/50 hover:bg-white/80",
              status.kind === "uploading" && "pointer-events-none",
            )}
          >
            <input ref={inputRef} type="file" accept="application/pdf,.pdf,text/plain,.txt" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); }} aria-describedby={`${id}-hint`} />
            {status.kind === "uploading" ? (
              <>
                <span className="size-6 animate-spin rounded-full border-2 border-green border-t-transparent" aria-hidden />
                <span className="text-[14px] text-head" role="status">Читаем {status.name}…</span>
              </>
            ) : (
              <>
                <UploadCloud className={cx("size-7 transition-colors", drag ? "text-green" : "text-teal")} strokeWidth={1.5} aria-hidden />
                <span className="text-[14.5px] text-head"><span className="font-medium underline decoration-line underline-offset-4 group-hover:decoration-teal">Выбери файл</span> или перетащи сюда</span>
                <span id={`${id}-hint`} className="label !text-[10px]">PDF или TXT · до 5 МБ</span>
              </>
            )}
          </label>
        )}
        {status.kind === "error" && (
          <p role="alert" className="mt-2 flex items-start gap-1.5 text-[13px] text-rose"><AlertCircle className="mt-0.5 size-3.5 shrink-0" />{status.message}. <button type="button" className="underline underline-offset-2" onClick={() => setTab("paste")}>Вставить текст</button></p>
        )}
      </div>

      <div id={`${id}-panel-paste`} hidden={tab !== "paste"}>
        <label htmlFor={`${id}-text`} className="sr-only">Текст CV</label>
        <textarea
          id={`${id}-text`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={10}
          placeholder={"Имя Фамилия\nData Analyst · Almaty\n\nExperience\nData Analyst — Company, Jan 2023 – Present\n• …"}
          className="field scroll-thin min-h-[220px] resize-y font-mono !text-[13px] leading-relaxed"
          aria-describedby={`${id}-count`}
        />
        <div id={`${id}-count`} className="mt-1.5 flex justify-between text-[12px] text-ink-3">
          <span>Скопируй текст из PDF, Word или LinkedIn</span>
          <span className={cx("num", chars > 0 && chars < minChars && "text-amber")}>{chars.toLocaleString("ru-RU")} симв.</span>
        </div>
      </div>
    </div>
  );
}
