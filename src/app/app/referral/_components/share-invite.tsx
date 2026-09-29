"use client";
import { useState, useSyncExternalStore } from "react";
import { Check, Copy, Link2, Send, Share2 } from "lucide-react";
import { cx } from "@/components/ui";
import { useT } from "@/lib/i18n/client";

const noop = () => () => {};
const ring = "focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-green";
const pill = cx("inline-flex h-11 items-center justify-center gap-2 rounded-full px-5 text-[14px] font-medium transition-colors", ring);

function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <path d="M12 2a10 10 0 0 0-8.66 15l-1.3 4.76 4.87-1.28A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.18-1.15l-.3-.18-2.89.76.77-2.82-.2-.29A8.2 8.2 0 1 1 12 20.2Zm4.5-6.14c-.25-.12-1.46-.72-1.69-.8-.23-.08-.39-.12-.55.12-.16.25-.63.8-.78.96-.14.17-.29.19-.53.06a6.7 6.7 0 0 1-3.34-2.92c-.25-.43.25-.4.72-1.34.08-.16.04-.3-.02-.43-.06-.12-.55-1.33-.76-1.82-.2-.48-.4-.41-.55-.42h-.47a.9.9 0 0 0-.65.3 2.74 2.74 0 0 0-.86 2.04 4.77 4.77 0 0 0 1 2.53 10.9 10.9 0 0 0 4.18 3.7c1.55.67 2.16.73 2.94.61.47-.07 1.46-.6 1.66-1.18.2-.58.2-1.07.15-1.18-.06-.1-.22-.16-.47-.29Z" />
    </svg>
  );
}

/** Personal invite link: copy, Telegram, WhatsApp and the system share sheet (where the browser has one). */
export function ShareInvite({ url, code, text }: { url: string; code: string; text: string }) {
  const t = useT();
  const [copied, setCopied] = useState<"idle" | "ok" | "fail">("idle");
  const [error, setError] = useState<string | null>(null);
  const canShare = useSyncExternalStore(noop, () => typeof navigator.share === "function", () => false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied("ok");
    } catch {
      setCopied("fail");
    }
    setTimeout(() => setCopied("idle"), 2200);
  };

  const share = async () => {
    setError(null);
    try {
      await navigator.share({ title: "Simplify", text, url });
    } catch (e) {
      if ((e as Error)?.name !== "AbortError") setError(t("referralPage.share.shareUnavailable"));
    }
  };

  const tg = `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`;
  const wa = `https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex min-w-0 items-center gap-2 rounded-full border border-line bg-white/80 py-1.5 pl-4 pr-1.5">
        <Link2 className="size-4 shrink-0 text-teal" strokeWidth={1.7} aria-hidden />
        <input
          readOnly value={url.replace(/^https?:\/\//, "")} aria-label={t("referralPage.share.linkAria")} onFocus={(e) => e.currentTarget.select()}
          className="min-w-0 flex-1 truncate bg-transparent font-mono text-[13px] text-head outline-none focus-visible:underline"
        />
        <button type="button" onClick={copy} className={cx("inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full bg-cta px-4 text-[13px] font-medium text-white shadow-(--shadow-cta) transition hover:bg-[#2f2c2c]", ring)}>
          {copied === "ok" ? <Check className="size-3.5" strokeWidth={2} aria-hidden /> : <Copy className="size-3.5" strokeWidth={1.8} aria-hidden />}
          <span aria-live="polite">{copied === "ok" ? t("referralPage.share.copied") : copied === "fail" ? t("referralPage.share.copyFailedShort") : t("referralPage.share.copy")}</span>
        </button>
      </div>
      <div className="flex flex-wrap gap-2">
        <a href={tg} target="_blank" rel="noopener noreferrer" className={cx(pill, "bg-[#229ED9] text-white hover:brightness-105")}>
          <Send className="size-4" strokeWidth={1.8} aria-hidden />Telegram<span className="sr-only">{t("referralPage.share.newTab")}</span>
        </a>
        <a href={wa} target="_blank" rel="noopener noreferrer" className={cx(pill, "bg-[#25D366] text-[#0b2e1a] hover:brightness-105")}>
          <WhatsAppIcon className="size-4" />WhatsApp<span className="sr-only">{t("referralPage.share.newTab")}</span>
        </a>
        {canShare && (
          <button type="button" onClick={share} className={cx(pill, "glass !rounded-full text-head hover:bg-white")}>
            <Share2 className="size-4" strokeWidth={1.7} aria-hidden />{t("referralPage.share.share")}
          </button>
        )}
      </div>
      <p className="break-words text-[12.5px] text-ink-3">{t.rich("referralPage.share.code", { code }, { code: (c) => <span className="font-mono tracking-[.06em] text-head">{c}</span> })}</p>
      {copied === "fail" && <p role="alert" className="text-[13px] text-rose">{t("referralPage.share.copyFailed")}</p>}
      {error && <p role="alert" className="text-[13px] text-rose">{error}</p>}
    </div>
  );
}
