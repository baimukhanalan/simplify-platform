import { ExternalLink, Link2 } from "lucide-react";
import { disconnectHh } from "@/lib/actions/hh";
import { hhEnabled, hhIntegration, myResumes, readHhMeta, type HhResume } from "@/lib/hh/client";
import { Card, cx } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { HhResumeForm } from "./hh-resume-form";

const NOTICE: Record<string, { tone: "green" | "amber" | "rose"; text: string }> = {
  connected: { tone: "green", text: "hh.kz подключён." },
  disabled: { tone: "amber", text: "Интеграция hh.kz ещё не включена на сервере." },
  denied: { tone: "amber", text: "Ты отменил доступ на hh.kz — ничего не подключено." },
  state: { tone: "rose", text: "Ссылка подключения устарела или открыта не в этой сессии. Нажми «Подключить» ещё раз." },
  "not-applicant": { tone: "rose", text: "Это аккаунт работодателя. Подключи свой аккаунт соискателя." },
  taken: { tone: "rose", text: "Этот аккаунт hh.kz уже подключён к другому профилю Simplify." },
  error: { tone: "rose", text: "Не удалось подключить hh.kz. Попробуй ещё раз чуть позже." },
};
const TONE = { green: "text-green", amber: "text-amber", rose: "text-rose" } as const;

const VISIBLE = new Set(["everyone", "clients", "whitelist", "blacklist", "direct"]);
const date = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("ru-RU", { timeZone: "Asia/Almaty", day: "numeric", month: "long", year: "numeric" }) : "");

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

  return (
    <Card id="hh" className="flex scroll-mt-24 flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="label">hh.kz</h2>
        <span className={cx("inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[.08em]", connected && meta.status !== "reconnect" ? "text-green" : "text-amber")}>
          <span className={cx("size-2 rounded-full", connected && meta.status !== "reconnect" ? "bg-green" : "bg-amber")} aria-hidden />
          {!connected ? "Не подключён" : meta.status === "reconnect" ? "Нужно переподключить" : "Подключён"}
        </span>
      </div>
      {note && <p role="status" className={cx("text-[13.5px]", TONE[note.tone])}>{note.text}</p>}

      {!connected ? (
        <>
          <p className="text-[13.5px] leading-relaxed text-ink-2">
            Подключи <b className="font-medium text-head">свой</b> аккаунт hh.kz — агент будет откликаться от твоего имени и с твоим резюме, в пределах лимитов и согласий выше. Вакансии с тестом или анкетой он оставит тебе. Пароль от hh Simplify не видит: вход — на самом hh.kz.
          </p>
          <a href="/api/integrations/hh/connect" className="inline-flex h-10 w-fit items-center gap-2 rounded-full bg-cta px-4 text-[13px] font-medium text-white shadow-(--shadow-cta) hover:bg-[#2f2c2c] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-green">
            <Link2 className="size-4" strokeWidth={1.7} aria-hidden />Подключить hh.kz
          </a>
        </>
      ) : (
        <>
          <p className="text-[13.5px] text-ink-2">
            Аккаунт: <b className="font-medium text-head">{meta.name || "hh.kz"}</b>
            {meta.lastSyncAt && <span className="text-ink-3"> · статусы откликов обновлены {date(meta.lastSyncAt)}</span>}
          </p>
          {meta.status === "reconnect" ? (
            <>
              <p className="text-[13.5px] text-amber">Доступ к hh.kz истёк или был отозван. Пока ты не переподключишь аккаунт, вакансии hh ждут твоей отправки.</p>
              <a href="/api/integrations/hh/connect" className="inline-flex h-10 w-fit items-center gap-2 rounded-full bg-cta px-4 text-[13px] font-medium text-white shadow-(--shadow-cta) hover:bg-[#2f2c2c] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-green">
                <Link2 className="size-4" strokeWidth={1.7} aria-hidden />Переподключить
              </a>
            </>
          ) : resumes === null ? (
            <p className="text-[13.5px] text-amber">Не удалось загрузить резюме с hh.kz — обнови страницу чуть позже.</p>
          ) : resumes.length === 0 ? (
            <p className="text-[13.5px] text-amber">
              В аккаунте нет резюме. Создай его на{" "}
              <a href="https://hh.kz/applicant/resumes" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 underline underline-offset-2">hh.kz<ExternalLink className="size-3" aria-hidden /><span className="sr-only">(откроется в новой вкладке)</span></a>
              {" "}— и выбери здесь.
            </p>
          ) : (
            <>
              {!row?.resumeId && <p className="text-[13px] text-amber">Выбери резюме — без него агент не откликается, а передаёт вакансии тебе.</p>}
              <HhResumeForm
                selected={row?.resumeId ?? ""}
                resumes={resumes.map((r) => ({ id: r.id, title: r.title, updated: date(r.updatedAt), visibility: r.visibility, visible: VISIBLE.has(r.visibilityId) }))}
              />
            </>
          )}
          <form action={disconnectHh} className="border-t border-line pt-4">
            <SubmitButton variant="ghost" size="sm" pendingText="Отключаем…" className="!h-10 !px-0 text-ink-3 hover:!bg-transparent hover:text-rose">Отключить hh.kz</SubmitButton>
          </form>
        </>
      )}
    </Card>
  );
}
