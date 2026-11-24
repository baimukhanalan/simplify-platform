"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "@/components/ui";

const ITEMS = [
  { href: "/admin", label: "Обзор" },
  { href: "/admin/funnel", label: "Воронка" },
  { href: "/admin/leads", label: "Заявки" },
  { href: "/admin/users", label: "Пользователи" },
  { href: "/admin/payments", label: "Платежи" },
  { href: "/admin/campaigns", label: "Кампании" },
  { href: "/admin/ops", label: "Операции" },
  { href: "/admin/errors", label: "Ошибки" },
];

/** `badges`: a count shown next to an item (e.g. new leads), keyed by href. */
export function AdminNav({ badges = {} }: { badges?: Record<string, number> }) {
  const path = usePathname();
  const active = (href: string) => (href === "/admin" ? path === "/admin" : path === href || path.startsWith(`${href}/`));
  return (
    <nav aria-label="Разделы админ-панели" className="scroll-thin -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <ul className="flex w-max gap-1 py-2">
        {ITEMS.map((it) => {
          const on = active(it.href);
          return (
            <li key={it.href}>
              <Link
                href={it.href}
                aria-current={on ? "page" : undefined}
                className={cx(
                  "inline-flex h-9 items-center rounded-full px-3.5 text-[13.5px] transition-colors focus-visible:outline-2 focus-visible:outline-green",
                  on ? "bg-cta text-white" : "text-ink-2 hover:bg-white/70",
                )}
              >
                {it.label}
                {badges[it.href] ? (
                  <span className={cx("num ml-1.5 inline-grid h-5 min-w-5 place-items-center rounded-full px-1.5 text-[11px] leading-none", on ? "bg-white text-head" : "bg-green text-white")}>
                    {badges[it.href] > 99 ? "99+" : badges[it.href]}
                    <span className="sr-only"> новых</span>
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
