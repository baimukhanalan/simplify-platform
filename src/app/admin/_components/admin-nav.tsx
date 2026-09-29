"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "@/components/ui";

const ITEMS = [
  { href: "/admin", label: "Обзор" },
  { href: "/admin/funnel", label: "Воронка" },
  { href: "/admin/users", label: "Пользователи" },
  { href: "/admin/payments", label: "Платежи" },
  { href: "/admin/campaigns", label: "Кампании" },
  { href: "/admin/ops", label: "Операции" },
  { href: "/admin/errors", label: "Ошибки" },
];

export function AdminNav() {
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
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
