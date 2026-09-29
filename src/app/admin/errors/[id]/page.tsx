import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireAdmin } from "@/lib/auth";
import { Card, Chip, Label, PageHeader, Stat } from "@/components/ui";
import { getError } from "@/lib/monitoring/admin";
import { fmtNum, plural } from "@/lib/ru";
import { ago, fmtDateTime } from "../../_components/fmt";
import { Sparkline } from "../_components/sparkline";
import { ResolveButton, SourceChips } from "../_components/bits";

export const metadata = { title: "Ошибка · Admin" };

const USERS: [string, string, string] = ["пользователь", "пользователя", "пользователей"];

export default async function ErrorDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const now = new Date();
  const e = await getError(id, now);
  if (!e) notFound();
  const last24 = e.series.reduce((a, b) => a + b, 0);
  const extra = Object.keys(e.extra).length ? JSON.stringify(e.extra, null, 2) : "";

  return (
    <>
      <Link href="/admin/errors" className="mb-4 inline-flex h-9 items-center gap-1.5 rounded-full px-2 text-[13px] text-ink-2 hover:bg-white/60 focus-visible:outline-2 focus-visible:outline-green">
        <ArrowLeft className="size-3.5" strokeWidth={1.7} aria-hidden /> Все ошибки
      </Link>
      <PageHeader
        eyebrow={`Admin · ${e.type}`}
        title={<span className="break-words [overflow-wrap:anywhere]">{e.message.length > 160 ? `${e.message.slice(0, 160)}…` : e.message}</span>}
        sub={
          <span className="flex flex-wrap items-center gap-1.5">
            <SourceChips source={e.source} level={e.level} reopened={Boolean(e.reopenedAt && !e.resolvedAt)} />
            {e.resolvedAt ? <Chip tone="green" dot>решено {ago(e.resolvedAt, now.getTime())}</Chip> : <Chip tone="rose" dot>открыта</Chip>}
          </span>
        }
        actions={e.resolvedAt ? undefined : <ResolveButton id={e.id} />}
      />

      <div className="flex flex-col gap-6">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Card><Stat label="Повторы" value={fmtNum(e.count, 0)} hint={`${fmtNum(last24, 0)} за 24 ч`} /></Card>
          <Card><Stat label="Затронуто" value={`${fmtNum(e.users.n, 0)}${e.users.capped ? "+" : ""}`} hint={plural(e.users.n, USERS)} /></Card>
          <Card><Stat label="Впервые" value={<span className="text-[20px]">{fmtDateTime(e.createdAt)}</span>} hint={ago(e.createdAt, now.getTime())} /></Card>
          <Card><Stat label="Последняя" value={<span className="text-[20px]">{fmtDateTime(e.lastSeenAt)}</span>} hint={ago(e.lastSeenAt, now.getTime())} /></Card>
        </div>

        <Card>
          <Label className="mb-3">Последние 24 часа · по часам</Label>
          <div className="text-teal"><Sparkline series={e.series} tall /></div>
          <div className="mt-1.5 flex justify-between text-[11px] text-ink-4"><span>24 ч назад</span><span>сейчас</span></div>
        </Card>

        <Card>
          <dl className="grid gap-x-6 gap-y-3 text-[13.5px] sm:grid-cols-[160px_1fr]">
            <dt className="label pt-0.5">Сообщение</dt>
            <dd className="break-words text-head [overflow-wrap:anywhere]">{e.message}</dd>
            <dt className="label pt-0.5">Маршрут</dt>
            <dd className="break-all font-mono text-[12.5px] text-ink-2">{e.route || "—"}</dd>
            {e.digest && (<><dt className="label pt-0.5">Digest</dt><dd className="break-all font-mono text-[12.5px] text-ink-2">{e.digest}</dd></>)}
            <dt className="label pt-0.5">Fingerprint</dt>
            <dd className="break-all font-mono text-[12.5px] text-ink-3">{e.fingerprint}</dd>
            {e.userId && (<><dt className="label pt-0.5">Последний пользователь</dt><dd><Link href={`/admin/users/${e.userId}`} className="font-mono text-[12.5px] text-green underline underline-offset-4">{e.userId}</Link></dd></>)}
            {e.reopenedAt && (<><dt className="label pt-0.5">Открыта снова</dt><dd className="text-ink-2">{fmtDateTime(e.reopenedAt)}</dd></>)}
          </dl>
        </Card>

        <Card className="!p-0">
          <h2 className="h-serif px-5 pt-5 text-[22px] sm:px-6">Stack trace</h2>
          {e.stack ? (
            <pre className="scroll-thin mt-3 max-h-[480px] overflow-auto border-t border-line bg-white/40 px-5 py-4 font-mono text-[12px] leading-[1.6] text-ink-2 sm:px-6"><code>{e.stack}</code></pre>
          ) : (
            <p className="px-6 py-5 text-[14px] text-ink-3">Стек не передан.</p>
          )}
        </Card>

        {extra && (
          <Card className="!p-0">
            <h2 className="h-serif px-5 pt-5 text-[22px] sm:px-6">Контекст</h2>
            <pre className="scroll-thin mt-3 max-h-[360px] overflow-auto border-t border-line bg-white/40 px-5 py-4 font-mono text-[12px] leading-[1.6] text-ink-2 sm:px-6"><code>{extra}</code></pre>
          </Card>
        )}
      </div>
    </>
  );
}
