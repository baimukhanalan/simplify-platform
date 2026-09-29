"use client";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { Check, ExternalLink, RefreshCw } from "lucide-react";
import { Button, Chip, cx } from "@/components/ui";
import { useT } from "@/lib/i18n/client";
import { cancelTelegramLink, pingTelegram, pollTelegramLink, setTelegramEnabled, startTelegramLink, unlinkTelegram, type ActionResult, type TelegramState } from "@/lib/actions/telegram";

const POLL_MS = 2500;

const Spinner = () => <span className="inline-block size-3.5 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />;

type Note = { tone: "ok" | "error"; text: string } | null;

export function TelegramPanel({ initial }: { initial: TelegramState }) {
  const t = useT();
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
        setNote({ tone: "error", text: t("telegramCard.failed") });
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
        {header(<Chip>{t("telegramCard.soon")}</Chip>)}
        <p className="text-[13.5px] text-ink-3">{t("telegramCard.soonText")}</p>
        <Button type="button" disabled className="mt-auto w-fit">{t("telegramCard.connect")}</Button>
      </>
    );

  // ——— Connected ———
  if (state.linked)
    return (
      <>
        {header(<Chip tone="green" dot>{t("telegramCard.connected")}</Chip>)}
        <p className="text-[13.5px] text-ink-3">
          {t("telegramCard.linkedText")}
          {state.linkedAt && (
            <>
              {" "}
              {t.rich("telegramCard.linkedAt", {}, {
                time: () => <time dateTime={state.linkedAt!} suppressHydrationWarning>{t.date(state.linkedAt, "dateTime")}</time>,
              })}
            </>
          )}
        </p>
        <label className="flex cursor-pointer items-center justify-between gap-4 rounded-xl py-1 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-4 has-[:focus-visible]:outline-green">
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="text-[15px] text-head">{t("telegramCard.sendToggle")}</span>
            <span className="text-[12.5px] text-ink-3">{state.enabled ? t("telegramCard.enabledText") : t("telegramCard.pausedText")}</span>
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
          <div role="group" aria-label={t("telegramCard.confirmAria")} className="flex flex-col gap-3 border-t border-line pt-4">
            <p className="text-[13.5px] text-ink-2">{t("telegramCard.confirmText")}</p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="danger" size="sm" disabled={busy === "unlink"} aria-busy={busy === "unlink" || undefined} onClick={() => run("unlink", unlinkTelegram, () => setConfirming(false))}>
                {busy === "unlink" && <Spinner />}
                {busy === "unlink" ? t("telegramCard.unlinking") : t("telegramCard.confirmYes")}
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setConfirming(false)}>{t("telegramCard.cancel")}</Button>
            </div>
          </div>
        ) : (
          <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line pt-4">
            <Button type="button" variant="glass" size="sm" disabled={busy === "ping"} aria-busy={busy === "ping" || undefined} onClick={() => run("ping", pingTelegram, (r) => { if (r.ok) setNote({ tone: "ok", text: t("telegramCard.pingSent") }); })}>
              {busy === "ping" ? <Spinner /> : <Check className="size-4" strokeWidth={1.7} aria-hidden />}
              {busy === "ping" ? t("telegramCard.checking") : t("telegramCard.ping")}
            </Button>
            <button type="button" onClick={() => { setNote(null); setConfirming(true); }} className="inline-flex min-h-10 items-center rounded text-[14px] text-rose hover:underline focus-visible:outline-2 focus-visible:outline-green">
              {t("telegramCard.unlink")}
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
        {header(<Chip tone="amber" dot>{t("telegramCard.waiting")}</Chip>)}
        <p className="flex items-start gap-2 text-[13.5px] text-ink-2" role="status" aria-live="polite">
          <span className="mt-1 text-amber"><Spinner /></span>
          {state.mode === "live" ? <span>{t("telegramCard.waitingLive")}</span> : <span>{t("telegramCard.waitingSim")}</span>}
        </p>
        <div className="mt-auto flex flex-wrap items-center gap-2">
          {pending.url && (
            <a href={pending.url} target="_blank" rel="noopener noreferrer" className="inline-flex h-10 items-center gap-2 rounded-full bg-cta px-4 text-[13px] font-medium text-[#fcfcfc] shadow-(--shadow-cta) transition-all hover:bg-[#2f2c2c] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-green active:scale-[.98]">
              <ExternalLink className="size-4" strokeWidth={1.7} aria-hidden />{t("telegramCard.open")}
            </a>
          )}
          {state.mode === "live" && (
            <Button type="button" variant="glass" size="sm" disabled={busy === "check"} aria-busy={busy === "check" || undefined} onClick={() => run("check", pollTelegramLink, (r) => { if (r.state && !r.state.linked && r.state.pending) setNote({ tone: "error", text: t("telegramCard.notConfirmed") }); })}>
              {busy === "check" ? <Spinner /> : <RefreshCw className="size-4" strokeWidth={1.7} aria-hidden />}
              {t("telegramCard.check")}
            </Button>
          )}
          <Button type="button" variant="ghost" size="sm" disabled={busy === "cancel"} onClick={() => run("cancel", cancelTelegramLink)}>{t("telegramCard.cancel")}</Button>
        </div>
        {noteEl}
      </>
    );

  // ——— Not connected ———
  return (
    <>
      {header(<Chip>{t("telegramCard.notConnected")}</Chip>)}
      <p className="text-[13.5px] text-ink-3">
        {expired ? t("telegramCard.expired") : t("telegramCard.intro")}
      </p>
      <Button type="button" className="mt-auto w-fit" disabled={busy === "connect"} aria-busy={busy === "connect" || undefined} onClick={connect}>
        {busy === "connect" && <Spinner />}
        {busy === "connect" ? t("telegramCard.preparing") : t("telegramCard.connect")}
      </Button>
      {noteEl}
    </>
  );
}
