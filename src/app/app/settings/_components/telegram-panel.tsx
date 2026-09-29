"use client";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { Check, ExternalLink, RefreshCw } from "lucide-react";
import { Button, Chip, cx } from "@/components/ui";
import { cancelTelegramLink, pingTelegram, pollTelegramLink, setTelegramEnabled, startTelegramLink, unlinkTelegram, type ActionResult, type TelegramState } from "@/lib/actions/telegram";

const POLL_MS = 2500;
const TZ = "Asia/Almaty";
const fmtDate = (iso: string) => new Date(iso).toLocaleString("ru-RU", { timeZone: TZ, day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });

const Spinner = () => <span className="inline-block size-3.5 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />;

type Note = { tone: "ok" | "error"; text: string } | null;

export function TelegramPanel({ initial }: { initial: TelegramState }) {
  const [state, setState] = useState(initial);
  const [note, setNote] = useState<Note>(null);
  const [busy, setBusy] = useState<null | "connect" | "check" | "cancel" | "toggle" | "ping" | "unlink">(null);
  const [expired, setExpired] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [, startTransition] = useTransition();
  const polling = useRef(false);

  const apply = useCallback((r: ActionResult) => {
    if (r.state) setState(r.state);
    if (r.error) setNote({ tone: "error", text: r.error });
  }, []);

  const run = (kind: NonNullable<typeof busy>, fn: () => Promise<ActionResult>, after?: (r: ActionResult) => void) => {
    if (busy) return;
    setBusy(kind);
    setNote(null);
    startTransition(async () => {
      try {
        const r = await fn();
        apply(r);
        after?.(r);
      } catch {
        setNote({ tone: "error", text: "Не получилось. Проверь соединение и попробуй ещё раз." });
      } finally {
        setBusy(null);
      }
    });
  };

  // Waiting for the bot: poll while the tab is visible, stop when linked or the code expires.
  const pending = state.pending;
  useEffect(() => {
    if (state.linked || !pending) return;
    const expiresAt = new Date(pending.expiresAt).getTime();
    const tick = async () => {
      if (polling.current || document.visibilityState !== "visible") return;
      if (Date.now() >= expiresAt) {
        setExpired(true);
        setState((s) => ({ ...s, pending: null }));
        return;
      }
      polling.current = true;
      try {
        const r = await pollTelegramLink();
        if (r.state) setState(r.state);
      } catch {
        /* offline for a moment — the next tick retries */
      } finally {
        polling.current = false;
      }
    };
    const id = window.setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [state.linked, pending]);

  const connect = () =>
    run("connect", startTelegramLink, (r) => {
      setExpired(false);
      const url = r.state?.pending?.url;
      if (url) {
        const w = window.open(url, "_blank");
        if (w) w.opener = null;
      }
    });

  const header = (chip: React.ReactNode) => (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 id="tg-h" className="h-serif text-[19px]">Telegram</h3>
      {chip}
    </div>
  );

  const noteEl = (
    <p role="status" aria-live="polite" className={cx("min-h-5 text-[13px]", note?.tone === "error" ? "text-rose" : "text-green")}>
      {note?.text}
    </p>
  );

  // ——— «Скоро»: live mode without a bot ———
  if (state.mode === "off")
    return (
      <>
        {header(<Chip>Скоро</Chip>)}
        <p className="text-[13.5px] text-ink-3">Приглашения на интервью, тестовые задания и офферы — сразу в Telegram. Подключение появится в ближайшее время.</p>
        <Button type="button" disabled className="mt-auto w-fit">Подключить Telegram</Button>
      </>
    );

  // ——— Connected ———
  if (state.linked)
    return (
      <>
        {header(<Chip tone="green" dot>Подключён</Chip>)}
        <p className="text-[13.5px] text-ink-3">
          Бот Simplify пишет, когда происходит важное: приглашение на интервью, тестовое задание, оффер.
          {state.linkedAt && (
            <>
              {" "}Подключён <time dateTime={state.linkedAt} suppressHydrationWarning>{fmtDate(state.linkedAt)}</time>.
            </>
          )}
        </p>
        <label className="flex cursor-pointer items-center justify-between gap-4 rounded-xl py-1 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-4 has-[:focus-visible]:outline-green">
          <span className="flex flex-col gap-0.5">
            <span className="text-[15px] text-head">Присылать уведомления</span>
            <span className="text-[12.5px] text-ink-3">{state.enabled ? "Новости поиска приходят в Telegram." : "На паузе — чат остаётся подключённым."}</span>
          </span>
          <input
            type="checkbox"
            role="switch"
            checked={state.enabled}
            disabled={busy === "toggle"}
            aria-busy={busy === "toggle" || undefined}
            onChange={(e) => {
              if (busy) return;
              const next = e.currentTarget.checked;
              setState((s) => ({ ...s, enabled: next }));
              run("toggle", () => setTelegramEnabled(next), (r) => { if (r.error) setState((s) => ({ ...s, enabled: !next })); });
            }}
            className="peer sr-only"
          />
          <span className="relative h-6 w-11 shrink-0 rounded-full bg-head/15 transition-colors peer-checked:bg-green peer-disabled:opacity-60 after:absolute after:left-0.5 after:top-0.5 after:size-5 after:rounded-full after:bg-white after:shadow after:transition-transform peer-checked:after:translate-x-5" aria-hidden />
        </label>
        {confirming ? (
          <div role="group" aria-label="Подтверждение отключения" className="flex flex-col gap-3 border-t border-line pt-4">
            <p className="text-[13.5px] text-ink-2">Отключить Telegram? Уведомления перестанут приходить, подключить снова можно в любой момент.</p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="danger" size="sm" disabled={busy === "unlink"} aria-busy={busy === "unlink" || undefined} onClick={() => run("unlink", unlinkTelegram, () => setConfirming(false))}>
                {busy === "unlink" && <Spinner />}
                {busy === "unlink" ? "Отключаем…" : "Да, отключить"}
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setConfirming(false)}>Отмена</Button>
            </div>
          </div>
        ) : (
          <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line pt-4">
            <Button type="button" variant="glass" size="sm" disabled={busy === "ping"} aria-busy={busy === "ping" || undefined} onClick={() => run("ping", pingTelegram, (r) => { if (r.ok) setNote({ tone: "ok", text: "Сообщение отправлено — проверь Telegram." }); })}>
              {busy === "ping" ? <Spinner /> : <Check className="size-4" strokeWidth={1.7} aria-hidden />}
              {busy === "ping" ? "Проверяем…" : "Проверить связь"}
            </Button>
            <button type="button" onClick={() => { setNote(null); setConfirming(true); }} className="inline-flex min-h-10 items-center rounded text-[14px] text-rose hover:underline focus-visible:outline-2 focus-visible:outline-green">
              Отключить
            </button>
          </div>
        )}
        {noteEl}
      </>
    );

  // ——— Waiting for the bot ———
  if (pending)
    return (
      <>
        {header(<Chip tone="amber" dot>Ждём бота</Chip>)}
        <p className="flex items-start gap-2 text-[13.5px] text-ink-2" role="status" aria-live="polite">
          <span className="mt-1 text-amber"><Spinner /></span>
          {state.mode === "live" ? <span>В Telegram нажми «Запустить» (Start) — чат подключится автоматически, эта страница обновится сама.</span> : <span>Подключаем Telegram…</span>}
        </p>
        <div className="mt-auto flex flex-wrap items-center gap-2">
          {pending.url && (
            <a href={pending.url} target="_blank" rel="noopener noreferrer" className="inline-flex h-10 items-center gap-2 rounded-full bg-cta px-4 text-[13px] font-medium text-[#fcfcfc] shadow-(--shadow-cta) transition-all hover:bg-[#2f2c2c] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-green active:scale-[.98]">
              <ExternalLink className="size-4" strokeWidth={1.7} aria-hidden />Открыть Telegram
            </a>
          )}
          {state.mode === "live" && (
            <Button type="button" variant="glass" size="sm" disabled={busy === "check"} aria-busy={busy === "check" || undefined} onClick={() => run("check", pollTelegramLink, (r) => { if (r.state && !r.state.linked && r.state.pending) setNote({ tone: "error", text: "Пока не видим подтверждения. Нажми «Запустить» в чате с ботом." }); })}>
              {busy === "check" ? <Spinner /> : <RefreshCw className="size-4" strokeWidth={1.7} aria-hidden />}
              Проверить
            </Button>
          )}
          <Button type="button" variant="ghost" size="sm" disabled={busy === "cancel"} onClick={() => run("cancel", cancelTelegramLink)}>Отмена</Button>
        </div>
        {noteEl}
      </>
    );

  // ——— Not connected ———
  return (
    <>
      {header(<Chip>Не подключён</Chip>)}
      <p className="text-[13.5px] text-ink-3">
        {expired ? "Ссылка для подключения устарела — она действует 15 минут. Нажми ещё раз." : "Приглашения на интервью, тестовые задания и офферы — сразу в Telegram, даже когда Simplify закрыт."}
      </p>
      <Button type="button" className="mt-auto w-fit" disabled={busy === "connect"} aria-busy={busy === "connect" || undefined} onClick={connect}>
        {busy === "connect" && <Spinner />}
        {busy === "connect" ? "Готовим ссылку…" : "Подключить Telegram"}
      </Button>
      {noteEl}
    </>
  );
}
