"use client";
import { useState, useSyncExternalStore, useTransition } from "react";
import { Check, Copy, Link2, RefreshCw, Share2, Unlink } from "lucide-react";
import { createShareLink, revokeShareLink, rotateShareLink } from "@/lib/actions/share";
import { cx } from "@/components/ui";
import { useT } from "@/lib/i18n/client";

const noop = () => () => {};
const ring = "focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[#7fe3b6]";

/** "Share my Simplify journey": create the public link, then copy it or hand it to the native share sheet. */
export function ShareJourney({ initialPath, shareText }: { initialPath: string | null; shareText: string }) {
  const [path, setPath] = useState(initialPath);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<"idle" | "ok" | "fail">("idle");
  const [pending, start] = useTransition();
  const t = useT();
  // Browser-only values read without a hydration mismatch (server snapshot = null / false).
  const origin = useSyncExternalStore(noop, () => window.location.origin, () => null);
  const canShare = useSyncExternalStore(noop, () => typeof navigator.share === "function", () => false);
  const url = path ? (origin ? new URL(path, origin).toString() : path) : null;

  const create = () =>
    start(async () => {
      setError(null);
      try {
        const res = await createShareLink();
        if (res.ok) setPath(res.path);
        else setError(res.error);
      } catch {
        setError(t("hiredPage.share.errCreate"));
      }
    });

  const rotate = () =>
    start(async () => {
      setError(null);
      try {
        const res = await rotateShareLink();
        if (res.ok) setPath(res.path);
        else setError(res.error);
      } catch {
        setError(t("hiredPage.share.errRotate"));
      }
    });

  const revoke = () =>
    start(async () => {
      setError(null);
      try {
        await revokeShareLink();
        setPath(null);
      } catch {
        setError(t("hiredPage.share.errRevoke"));
      }
    });

  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied("ok");
    } catch {
      setCopied("fail");
    }
    setTimeout(() => setCopied("idle"), 2200);
  };

  const share = async () => {
    if (!url) return;
    try {
      await navigator.share({ title: "HIRED. · Simplify", text: shareText, url });
    } catch (e) {
      if ((e as Error)?.name !== "AbortError") setError(t("hiredPage.share.errShare"));
    }
  };

  if (!path) {
    return (
      <div className="flex flex-col gap-2">
        <button type="button" onClick={create} disabled={pending} aria-busy={pending || undefined} className={cx("inline-flex h-12 w-fit items-center gap-2 rounded-full border border-white/20 px-6 text-[14.5px] text-white transition hover:bg-white/10 disabled:opacity-60", ring)}>
          {pending ? <span aria-hidden className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" /> : <Share2 className="size-4" strokeWidth={1.7} aria-hidden />}
          {pending ? t("hiredPage.share.creating") : t("hiredPage.share.cta")}
        </button>
        <p className="text-[12.5px] text-white/50">{t("hiredPage.share.publicNote")}</p>
        {error && <p role="alert" className="text-[13px] text-[#f2a7a8]">{error}</p>}
      </div>
    );
  }

  return (
    <div className="flex w-full max-w-xl flex-col gap-2.5">
      <div className="flex min-w-0 items-center gap-2 rounded-full border border-white/15 bg-white/[.06] py-1.5 pl-4 pr-1.5">
        <Link2 className="size-4 shrink-0 text-[#8fc7ad]" strokeWidth={1.7} aria-hidden />
        <input readOnly value={url ?? ""} aria-label={t("hiredPage.share.urlAria")} onFocus={(e) => e.currentTarget.select()} className={cx("min-w-0 flex-1 truncate bg-transparent text-[13.5px] text-white/85 outline-none", "focus-visible:underline")} />
        <button type="button" onClick={copy} className={cx("inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full bg-[#7fe3b6] px-4 text-[13px] font-medium text-[#0c1512] transition hover:bg-[#9aeec7]", ring)}>
          {copied === "ok" ? <Check className="size-3.5" strokeWidth={2} aria-hidden /> : <Copy className="size-3.5" strokeWidth={1.8} aria-hidden />}
          <span aria-live="polite">{t(copied === "ok" ? "hiredPage.share.copied" : copied === "fail" ? "hiredPage.share.copyFailShort" : "hiredPage.share.copy")}</span>
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {canShare && (
          <button type="button" onClick={share} className={cx("inline-flex h-10 items-center gap-2 rounded-full border border-white/20 px-4 text-[13.5px] text-white transition hover:bg-white/10", ring)}>
            <Share2 className="size-4" strokeWidth={1.7} aria-hidden />{t("hiredPage.share.share")}
          </button>
        )}
        <a href={path} target="_blank" rel="noopener" className={cx("inline-flex min-h-10 items-center rounded text-[13px] text-white/60 underline-offset-4 hover:text-white hover:underline", ring)}>
          {t("hiredPage.share.openPublic")}<span className="sr-only">{t("hiredPage.share.newTab")}</span>
        </a>
        <button type="button" onClick={rotate} disabled={pending} title={t("hiredPage.share.rotateTitle")} className={cx("inline-flex min-h-10 items-center gap-1.5 rounded text-[13px] text-white/60 hover:text-white disabled:opacity-60", ring)}>
          <RefreshCw className="size-3.5" strokeWidth={1.7} aria-hidden />{t("hiredPage.share.rotate")}
        </button>
        <button type="button" onClick={revoke} disabled={pending} className={cx("inline-flex min-h-10 items-center gap-1.5 rounded text-[13px] text-white/60 hover:text-[#f2a7a8] disabled:opacity-60", ring)}>
          <Unlink className="size-3.5" strokeWidth={1.7} aria-hidden />{t("hiredPage.share.revoke")}
        </button>
      </div>
      {copied === "fail" && <p role="alert" className="text-[13px] text-[#f2a7a8]">{t("hiredPage.share.copyFail")}</p>}
      {error && <p role="alert" className="text-[13px] text-[#f2a7a8]">{error}</p>}
    </div>
  );
}
