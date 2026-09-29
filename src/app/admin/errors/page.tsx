import Link from "next/link";
import { Search } from "lucide-react";
import { requireAdmin } from "@/lib/auth";
import { Card, PageHeader, Script, Stat, cx } from "@/components/ui";
import { PAGE_SIZE, listErrors, parseQuery, parseSort, parseTab, type ErrorSort, type ErrorTab } from "@/lib/monitoring/admin";
import { count, fmtNum } from "@/lib/ru";
import { ago } from "../_components/fmt";
import { Sparkline } from "./_components/sparkline";
import { ResolveButton, SourceChips } from "./_components/bits";

export const metadata = { title: "Ошибки · Admin" };

const USERS: [string, string, string] = ["пользователь", "пользователя", "пользователей"];

function href(p: { tab: ErrorTab; sort: ErrorSort; q: string }) {
  const s = new URLSearchParams();
  if (p.tab !== "open") s.set("tab", p.tab);
  if (p.sort !== "last") s.set("sort", p.sort);
  if (p.q) s.set("q", p.q);
  const qs = s.toString();
  return `/admin/errors${qs ? `?${qs}` : ""}`;
}

export default async function ErrorsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdmin();
  const sp = await searchParams;
  const tab = parseTab(sp.tab), sort = parseSort(sp.sort), q = parseQuery(sp.q);
  const now = new Date();
  const { rows, total, openCount, resolvedCount, last24 } = await listErrors({ tab, sort, q }, now);
  const occurrences24 = rows.reduce((a, r) => a + r.series.reduce((x, y) => x + y, 0), 0);

  const pill = (on: boolean) => cx("inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] focus-visible:outline-2 focus-visible:outline-green", on ? "bg-cta text-white" : "text-ink-2 hover:bg-white");

  return (
    <>
      <PageHeader
        eyebrow="Admin · мониторинг"
        title={<>Ошибки <Script>платформы</Script></>}
        sub="Сервер, server actions, cron и браузер. Одинаковые ошибки сгруппированы; «Решено» закрывает группу — если ошибка повторится, она откроется снова."
      />

      <div className="flex flex-col gap-6">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Card><Stat label="Открыто" value={fmtNum(openCount, 0)} tone={openCount ? "rose" : undefined} hint="групп ошибок" /></Card>
          <Card><Stat label="Активны за 24 ч" value={fmtNum(last24, 0)} hint="открытых групп" /></Card>
          <Card><Stat label="Повторов за 24 ч" value={fmtNum(occurrences24, 0)} hint={tab === "open" ? "по показанным группам" : "по решённым группам"} /></Card>
          <Card><Stat label="Решено" value={fmtNum(resolvedCount, 0)} hint="групп" /></Card>
        </div>

        <Card className="!p-0">
          <div className="flex flex-col gap-3 px-5 pt-5 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <nav aria-label="Статус" className="glass inline-flex !rounded-full p-1">
                <Link href={href({ tab: "open", sort, q })} aria-current={tab === "open" ? "page" : undefined} className={pill(tab === "open")}>Открытые <span className="num text-[12px] opacity-70">{openCount}</span></Link>
                <Link href={href({ tab: "resolved", sort, q })} aria-current={tab === "resolved" ? "page" : undefined} className={pill(tab === "resolved")}>Решённые <span className="num text-[12px] opacity-70">{resolvedCount}</span></Link>
              </nav>
              <nav aria-label="Сортировка" className="glass inline-flex !rounded-full p-1">
                <Link href={href({ tab, sort: "last", q })} aria-current={sort === "last" ? "true" : undefined} className={pill(sort === "last")}>Недавние</Link>
                <Link href={href({ tab, sort: "count", q })} aria-current={sort === "count" ? "true" : undefined} className={pill(sort === "count")}>Частые</Link>
              </nav>
            </div>
            <form role="search" action="/admin/errors" className="flex w-full items-center gap-2 lg:w-[360px]">
              {tab !== "open" && <input type="hidden" name="tab" value={tab} />}
              {sort !== "last" && <input type="hidden" name="sort" value={sort} />}
              <label className="relative flex-1">
                <span className="sr-only">Поиск по тексту, маршруту или digest</span>
                <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-ink-4" strokeWidth={1.7} aria-hidden />
                <input name="q" type="search" defaultValue={q} maxLength={120} placeholder="Текст, маршрут, digest" className="field !h-10 !py-0 !pl-10 !text-[14px]" />
              </label>
              <button className="glass inline-flex h-10 shrink-0 items-center !rounded-full px-4 text-[13px] text-head hover:bg-white focus-visible:outline-2 focus-visible:outline-green">Найти</button>
            </form>
          </div>

          {rows.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
              <span className="size-2.5 rounded-full bg-green" aria-hidden />
              <p className="h-serif text-[22px]">{q ? "Ничего не найдено" : tab === "open" ? "Открытых ошибок нет" : "Решённых ошибок пока нет"}</p>
              <p className="max-w-md text-[14px] text-ink-3">{q ? "Попробуй другой запрос или сбрось поиск." : tab === "open" ? "Всё работает штатно. Новые ошибки появятся здесь автоматически." : "Закрытые группы ошибок будут собираться здесь."}</p>
              {q && <Link href={href({ tab, sort, q: "" })} className="mt-1 text-[13.5px] text-green underline underline-offset-4">Сбросить поиск</Link>}
            </div>
          ) : (
            <>
              <ul className="mt-4 divide-y divide-line border-t border-line md:hidden">
                {rows.map((r) => (
                  <li key={r.id} className="flex flex-col gap-2 px-5 py-4">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <SourceChips source={r.source} level={r.level} reopened={Boolean(r.reopenedAt && !r.resolvedAt)} />
                      <span className="num ml-auto text-[13px] text-head">×{fmtNum(r.count, 0)}</span>
                    </div>
                    <Link href={`/admin/errors/${r.id}`} className="line-clamp-2 break-words text-[14px] font-medium text-head [overflow-wrap:anywhere] hover:underline focus-visible:outline-2 focus-visible:outline-green">
                      <span className="text-ink-3">{r.type}: </span>{r.message}
                    </Link>
                    <div className="flex items-center gap-3 text-[12px] text-ink-3">
                      <span className="min-w-0 flex-1 truncate font-mono">{r.route || "—"}</span>
                      <Sparkline series={r.series} className="text-teal" />
                    </div>
                    <div className="flex items-center justify-between gap-2 text-[12px] text-ink-3">
                      <span>{ago(r.lastSeenAt, now.getTime())} · {count(r.users.n, USERS)}{r.users.capped ? "+" : ""}</span>
                      {!r.resolvedAt && <ResolveButton id={r.id} small />}
                    </div>
                  </li>
                ))}
              </ul>
              <div className="scroll-thin mt-4 hidden overflow-x-auto md:block">
                <table className="w-full min-w-[900px] table-fixed text-left text-[13.5px]">
                  <colgroup><col /><col className="w-[190px]" /><col className="w-[80px]" /><col className="w-[110px]" /><col className="w-[110px]" /><col className="w-[120px]" /><col className="w-[130px]" /></colgroup>
                  <thead>
                    <tr className="border-b border-line">
                      {["Ошибка", "Маршрут", "Повторы", "Затронуто", "24 ч", "Последняя", ""].map((c, i) => <th key={i} scope="col" className="label px-4 py-2.5 !text-[11px] font-normal first:pl-6 last:pr-6">{c}</th>)}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {rows.map((r) => (
                      <tr key={r.id} className="align-top hover:bg-white/50">
                        <th scope="row" className="px-4 py-3 pl-6 font-normal">
                          <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                            <SourceChips source={r.source} level={r.level} reopened={Boolean(r.reopenedAt && !r.resolvedAt)} />
                          </div>
                          <Link href={`/admin/errors/${r.id}`} className="line-clamp-2 break-words text-head [overflow-wrap:anywhere] hover:underline focus-visible:outline-2 focus-visible:outline-green">
                            <span className="text-ink-3">{r.type}: </span>{r.message}
                          </Link>
                        </th>
                        <td className="truncate px-4 py-3 font-mono text-[12px] text-ink-3" title={r.route}>{r.route || "—"}</td>
                        <td className="num px-4 py-3 text-head">{fmtNum(r.count, 0)}</td>
                        <td className="num px-4 py-3 text-ink-2">{fmtNum(r.users.n, 0)}{r.users.capped ? "+" : ""}</td>
                        <td className="px-4 py-3 text-teal"><Sparkline series={r.series} /></td>
                        <td className="px-4 py-3 text-[12.5px] text-ink-3" title={r.lastSeenAt.toISOString()}>{ago(r.lastSeenAt, now.getTime())}</td>
                        <td className="px-4 py-3 pr-6 text-right">{r.resolvedAt ? <span className="text-[12.5px] text-ink-4">{ago(r.resolvedAt, now.getTime())}</span> : <ResolveButton id={r.id} small />}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {total > rows.length && <p className="border-t border-line px-6 py-3 text-[12.5px] text-ink-3">Показаны первые {PAGE_SIZE} из {fmtNum(total, 0)} — уточни поиск.</p>}
            </>
          )}
        </Card>
      </div>
    </>
  );
}
