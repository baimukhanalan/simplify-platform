import { ExternalLink, Link2 } from "lucide-react";
import { disconnectHh } from "@/lib/actions/hh";
import { hhEnabled, hhIntegration, myResumes, readHhMeta, type HhResume } from "@/lib/hh/client";
import { Card, cx } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { HhResumeForm } from "./hh-resume-form";
import { getT } from "@/lib/i18n/server";
import { I18nScope } from "@/lib/i18n/scope";
import type { NsKey } from "@/lib/i18n/translator";

const NOTICE: Record<string, { tone: "green" | "amber" | "rose"; key: NsKey<"agentPage"> }> = {
  connected: { tone: "green", key: "hh.notice.connected" },
  disabled: { tone: "amber", key: "hh.notice.disabled" },
  denied: { tone: "amber", key: "hh.notice.denied" },
  state: { tone: "rose", key: "hh.notice.state" },
  "not-applicant": { tone: "rose", key: "hh.notice.notApplicant" },
  taken: { tone: "rose", key: "hh.notice.taken" },
  error: { tone: "rose", key: "hh.notice.error" },
};
const TONE = { green: "text-green", amber: "text-amber", rose: "text-rose" } as const;

const VISIBLE = new Set(["everyone", "clients", "whitelist", "blacklist", "direct"]);

/** «hh.kz» on /app/agent: server status, connection, resume choice, disconnect. */
export async function HhCard({ userId, notice }: { userId: string; notice?: string }) {
  // Not configured on the server: the card is not rendered at all (no «coming soon» state).
  if (!hhEnabled()) return null;
  const row = await hhIntegration(userId);
  const meta = readHhMeta(row?.meta);
  const connected = Boolean(row?.accessToken);
  let resumes: HhResume[] | null = null;
  if (connected && meta.status !== "reconnect") resumes = await myResumes(userId).catch(() => null);
  const note = notice ? NOTICE[notice] : undefined;
  const t = await getT();
  const date = (iso: string | null) => (iso ? t.date(iso, "dayMonthYear") : "");

  return (
    <Card id="hh" className="flex scroll-mt-24 flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="label">hh.kz</h2>
        <span className={cx("inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[.08em]", connected && meta.status !== "reconnect" ? "text-green" : "text-amber")}>
          <span className={cx("size-2 rounded-full", connected && meta.status !== "reconnect" ? "bg-green" : "bg-amber")} aria-hidden />
          {!connected ? t("agentPage.hh.statusOff") : meta.status === "reconnect" ? t("agentPage.hh.statusReconnect") : t("agentPage.hh.statusOn")}
        </span>
      </div>
      {note && <p role="status" className={cx("text-[13.5px]", TONE[note.tone])}>{t(`agentPage.${note.key}`)}</p>}

      {!connected ? (
        <>
          <p className="text-[13.5px] leading-relaxed text-ink-2">
            {t.rich("agentPage.hh.intro", {}, { b: (c) => <b className="font-medium text-head">{c}</b> })}
          </p>
          <a href="/api/integrations/hh/connect" className="inline-flex h-10 w-fit items-center gap-2 rounded-full bg-cta px-4 text-[13px] font-medium text-white shadow-(--shadow-cta) hover:bg-[#2f2c2c] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-green">
            <Link2 className="size-4" strokeWidth={1.7} aria-hidden />{t("agentPage.hh.connect")}
          </a>
        </>
      ) : (
        <>
          <p className="text-[13.5px] text-ink-2">
            {t("agentPage.hh.account")} <b className="font-medium text-head">{meta.name || "hh.kz"}</b>
            {meta.lastSyncAt && <span className="text-ink-3"> · {t("agentPage.hh.synced", { date: date(meta.lastSyncAt) })}</span>}
          </p>
          {meta.status === "reconnect" ? (
            <>
              <p className="text-[13.5px] text-amber">{t("agentPage.hh.expired")}</p>
              <a href="/api/integrations/hh/connect" className="inline-flex h-10 w-fit items-center gap-2 rounded-full bg-cta px-4 text-[13px] font-medium text-white shadow-(--shadow-cta) hover:bg-[#2f2c2c] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-green">
                <Link2 className="size-4" strokeWidth={1.7} aria-hidden />{t("agentPage.hh.reconnect")}
              </a>
            </>
          ) : resumes === null ? (
            <p className="text-[13.5px] text-amber">{t("agentPage.hh.loadFailed")}</p>
          ) : resumes.length === 0 ? (
            <p className="text-[13.5px] text-amber">
              {t.rich("agentPage.hh.noResumes", {}, {
                link: (c) => <a href="https://hh.kz/applicant/resumes" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 underline underline-offset-2">{c}<ExternalLink className="size-3" aria-hidden /><span className="sr-only">{t("agentPage.hh.newTab")}</span></a>,
              })}
            </p>
          ) : (
            <>
              {!row?.resumeId && <p className="text-[13px] text-amber">{t("agentPage.hh.pickResume")}</p>}
              <I18nScope ns={["agentPage"]}>
                <HhResumeForm
                  selected={row?.resumeId ?? ""}
                  resumes={resumes.map((r) => ({ id: r.id, title: r.title, updated: date(r.updatedAt), visibility: r.visibility, visible: VISIBLE.has(r.visibilityId) }))}
                />
              </I18nScope>
            </>
          )}
          <form action={disconnectHh} className="border-t border-line pt-4">
            <SubmitButton variant="ghost" size="sm" pendingText={t("agentPage.hh.disconnecting")} className="!h-10 !px-0 text-ink-3 hover:!bg-transparent hover:text-rose">{t("agentPage.hh.disconnect")}</SubmitButton>
          </form>
        </>
      )}
    </Card>
  );
}
