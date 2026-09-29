import { redirect } from "next/navigation";
import { isSimulation } from "@/lib/mode";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Check, Download, X } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db, j } from "@/lib/db";
import { Card, Chip, Label, PageHeader, Script } from "@/components/ui";
import { RevokeKey, TokenPanel } from "./_components/token-panel";
import { getT } from "@/lib/i18n/server";
import { I18nScope } from "@/lib/i18n/scope";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("extensionPage.metaTitle") };
}

const DOES_KEYS = ["a", "b", "c", "d", "e"] as const;
const DOESNT_KEYS = ["a", "b", "c", "d"] as const;
const WHERE_ATS = ["Greenhouse", "Lever", "Ashby", "Workable"];
const STEP_KEYS = ["download", "open", "load", "key", "apply"] as const;

export default async function ExtensionPage() {
  const user = await requireUser();
  // Simulation mode: the agent answers and sends everything itself — nothing to confirm or send by hand here.
  if (isSimulation()) redirect("/app");
  const integ = await db.integration.findUnique({ where: { userId_provider: { userId: user.id, provider: "extension" } }, select: { tokenHash: true, meta: true } });
  const connected = Boolean(integ?.tokenHash);
  const meta = j<{ createdAt?: string; lastUsedAt?: string }>(integ?.meta, {});
  const t = await getT();
  const when = (iso?: string) => {
    if (!iso) return null;
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? null : t.date(d, "dateTime");
  };
  const mono = { m: (c: ReactNode) => <span className="font-mono text-head">{c}</span> };
  const DOES = DOES_KEYS.map((k) => t(`extensionPage.does.${k}`));
  const DOESNT = DOESNT_KEYS.map((k) => t(`extensionPage.doesnt.${k}`));
  const other = t("extensionPage.whereOther");
  const WHERE = [...WHERE_ATS, t("extensionPage.whereHh"), other];
  const STEPS = STEP_KEYS.map((k) => ({ t: t(`extensionPage.steps.${k}T`), d: t.rich(`extensionPage.steps.${k}D`, {}, mono) }));

  return (
    <>
      <PageHeader
        eyebrow={t("extensionPage.eyebrow")}
        title={t.rich("extensionPage.title", {}, { s: (c) => <Script>{c}</Script> })}
        sub={t("extensionPage.sub")}
      />

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex flex-col gap-6">
          <div className="grid gap-6 md:grid-cols-2">
            <Card className="flex flex-col gap-4">
              <h2 className="label">{t("extensionPage.doesTitle")}</h2>
              <ul className="flex flex-col gap-3">
                {DOES.map((t) => (
                  <li key={t} className="flex gap-2.5 text-[14px] leading-relaxed text-ink-2">
                    <Check className="mt-1 size-4 shrink-0 text-green" strokeWidth={2} aria-hidden />
                    {t}
                  </li>
                ))}
              </ul>
            </Card>
            <Card className="flex flex-col gap-4">
              <h2 className="label">{t("extensionPage.doesntTitle")}</h2>
              <ul className="flex flex-col gap-3">
                {DOESNT.map((t) => (
                  <li key={t} className="flex gap-2.5 text-[14px] leading-relaxed text-ink-2">
                    <X className="mt-1 size-4 shrink-0 text-rose" strokeWidth={2} aria-hidden />
                    {t}
                  </li>
                ))}
              </ul>
            </Card>
          </div>

          <Card className="flex flex-col gap-3">
            <h2 className="label">{t("extensionPage.whereTitle")}</h2>
            <div className="flex flex-wrap gap-2">
              {WHERE.map((w) => <Chip key={w} tone={w === other ? "neutral" : "green"}>{w}</Chip>)}
            </div>
            <p className="text-[13px] leading-relaxed text-ink-3">
              {t("extensionPage.whereNote")}
            </p>
          </Card>

          <Card strong className="flex flex-col gap-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <h2 className="h-serif text-[24px]">{t("extensionPage.installTitle")}</h2>
              <a
                href="/api/extension/download"
                download
                className="inline-flex h-11 items-center justify-center gap-2 self-start rounded-full bg-cta px-5 text-[14.5px] font-medium text-[#fcfcfc] shadow-(--shadow-cta) transition-all hover:bg-[#2f2c2c] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-green active:scale-[.98]"
              >
                <Download className="size-4" strokeWidth={1.7} aria-hidden />
                {t("extensionPage.download")}
              </a>
            </div>
            <ol className="flex flex-col gap-4">
              {STEPS.map((s, i) => (
                <li key={s.t} className="flex gap-4">
                  <span className="num grid size-8 shrink-0 place-items-center rounded-full bg-mint text-[14px] text-head">{i + 1}</span>
                  <div className="flex min-w-0 flex-col gap-1 pt-1">
                    <div className="text-[15px] font-medium text-head">{s.t}</div>
                    <p className="break-words text-[13.5px] leading-relaxed text-ink-2">{s.d}</p>
                  </div>
                </li>
              ))}
            </ol>
          </Card>
        </div>

        <div className="flex flex-col gap-6 lg:sticky lg:top-6">
          <Card strong className="flex flex-col gap-5">
            <div className="flex items-center justify-between gap-3">
              <h2 className="label">{t("extensionPage.key.title")}</h2>
              <Chip tone={connected ? "green" : "neutral"} dot>{connected ? (meta.lastUsedAt ? t("extensionPage.key.connected") : t("extensionPage.key.created")) : t("extensionPage.key.notConnected")}</Chip>
            </div>
            {connected ? (
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[13.5px]">
                <dt className="text-ink-3">{t("extensionPage.key.createdAt")}</dt>
                <dd className="text-head">{when(meta.createdAt) ?? "—"}</dd>
                <dt className="text-ink-3">{t("extensionPage.key.lastUsed")}</dt>
                <dd className="text-head">{when(meta.lastUsedAt) ?? t("extensionPage.key.neverUsed")}</dd>
              </dl>
            ) : (
              <p className="text-[14px] leading-relaxed text-ink-2">{t("extensionPage.key.intro")}</p>
            )}
            <I18nScope ns={["extensionPage"]}>
              <TokenPanel key={meta.createdAt ?? "none"} connected={connected} />
              {connected && <RevokeKey />}
            </I18nScope>
          </Card>

          <Card className="flex flex-col gap-2.5">
            <Label>{t("extensionPage.whyTitle")}</Label>
            <p className="text-[13.5px] leading-relaxed text-ink-2">
              {t("extensionPage.why")}
            </p>
          </Card>
        </div>
      </div>
    </>
  );
}
