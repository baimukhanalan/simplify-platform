import Link from "next/link";
import { cookies } from "next/headers";
import { Search, X } from "lucide-react";
import { requireAdmin } from "@/lib/auth";
import { Card, Chip, PageHeader, Script, cx } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { adminUserSearch } from "@/lib/actions/admin";
import { USERS_PAGE, usersPage } from "@/lib/admin/queries";
import { ADMIN_SEARCH_COOKIE, stageLabel } from "@/lib/admin/metrics";
import { fmtNum } from "@/lib/ru";
import { EmailReveal } from "../_components/email-reveal";
import { Pager } from "../_components/pager";
import { PLAN_LABEL, ago, fmtDate, clock } from "../_components/fmt";

export const metadata = { title: "Пользователи · Admin" };

export default async function UsersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdmin();
  const [sp, jar] = await Promise.all([searchParams, cookies()]);
  const q = (jar.get(ADMIN_SEARCH_COOKIE)?.value ?? "").slice(0, 100);
  const page = Math.max(1, Math.min(10_000, Number.parseInt(String(sp.page ?? "1"), 10) || 1));
  const { total, rows } = await usersPage(q, page);
  const pages = Math.max(1, Math.ceil(total / USERS_PAGE));
  const now = clock();

  return (
    <>
      <PageHeader eyebrow="Admin · пользователи" title={<>Все <Script>пользователи</Script></>} sub="Только просмотр. E-mail скрыт — открывай по кнопке, когда нужно." />

      <Card className="!p-0">
        <div className="flex flex-col gap-3 px-5 pt-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <form action={adminUserSearch} className="flex w-full max-w-md items-center gap-2" role="search">
            <label className="relative flex-1">
              <span className="sr-only">Поиск по имени, e-mail или id</span>
              <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-ink-4" strokeWidth={1.7} aria-hidden />
              <input name="q" defaultValue={q} maxLength={100} placeholder="Имя, e-mail или id" className="field !pl-10" autoComplete="off" />
            </label>
            <SubmitButton size="sm" pendingText="Ищем…">Найти</SubmitButton>
          </form>
          <div className="flex items-center gap-2 text-[13px] text-ink-3">
            {q && (
              <form action={adminUserSearch}>
                <input type="hidden" name="q" value="" />
                <button className="inline-flex h-8 items-center gap-1 rounded-full px-2.5 text-teal hover:bg-white/70 focus-visible:outline-2 focus-visible:outline-green"><X className="size-3.5" strokeWidth={1.7} />Сбросить поиск</button>
              </form>
            )}
            <span className="num">{fmtNum(total, 0)} найдено</span>
          </div>
        </div>

        {rows.length === 0 ? (
          <p className="px-6 py-8 text-[14px] text-ink-3">{q ? "Никого не нашли по этому запросу." : "Пользователей пока нет."}</p>
        ) : (
          <div className="scroll-thin mt-4 overflow-x-auto">
            <table className="w-full min-w-[1000px] text-left text-[13.5px]">
              <thead>
                <tr className="border-b border-line">
                  {["Пользователь", "Регистрация", "План", "День", "Заявки", "Интервью", "Активность", "Этап"].map((c) => <th key={c} scope="col" className="label px-4 py-2.5 !text-[11px] font-normal first:pl-6 last:pr-6">{c}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((u) => (
                  <tr key={u.id} className="hover:bg-white/50">
                    <th scope="row" className="max-w-[280px] px-4 py-2.5 pl-6 font-normal">
                      <Link href={`/admin/users/${u.id}`} className="block truncate font-medium text-head hover:underline focus-visible:outline-2 focus-visible:outline-green">{u.name || "Без имени"}</Link>
                      <span className="flex items-center gap-1.5">
                        <EmailReveal userId={u.id} masked={u.masked} />
                        {u.role !== "user" && <Chip tone="dark" className="!px-1.5 !py-0.5 !text-[9.5px]">{u.role}</Chip>}
                      </span>
                    </th>
                    <td className="whitespace-nowrap px-4 py-2.5 text-ink-2">{fmtDate(u.createdAt)}</td>
                    <td className="px-4 py-2.5">{u.plan ? <Chip tone={u.plan === "international" ? "dark" : "teal"}>{PLAN_LABEL[u.plan] ?? u.plan}</Chip> : <span className="text-ink-4">—</span>}</td>
                    <td className="num whitespace-nowrap px-4 py-2.5">{u.day ? <>{u.day.day}<span className="text-ink-4">/{u.day.total}</span>{u.campaignStatus === "paused" && <span className="ml-1 text-[11px] text-amber">пауза</span>}</> : <span className="text-ink-4">—</span>}</td>
                    <td className="num px-4 py-2.5">{u.applications}</td>
                    <td className="num px-4 py-2.5">{u.interviews}</td>
                    <td className={cx("whitespace-nowrap px-4 py-2.5 text-[12.5px]", now - u.lastActivity.getTime() > 7 * 86400000 ? "text-ink-4" : "text-ink-2")}>{ago(u.lastActivity, now)}</td>
                    <td className="px-4 py-2.5 pr-6"><Chip tone={u.stage === "hired" ? "green" : u.stage === "signup" ? "neutral" : "teal"}>{stageLabel(u.stage)}</Chip></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pager page={page} pages={pages} href={(p) => `/admin/users?page=${p}`} />
      </Card>
    </>
  );
}
