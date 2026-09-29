import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cx } from "@/components/ui";

export function Pager({ page, pages, href }: { page: number; pages: number; href: (p: number) => string }) {
  if (pages <= 1) return <div className="h-5" />;
  const btn = "inline-flex h-9 items-center gap-1 rounded-full px-3 text-[13px] focus-visible:outline-2 focus-visible:outline-green";
  return (
    <nav aria-label="Страницы" className="flex items-center justify-between gap-3 border-t border-line px-5 py-3 sm:px-6">
      {page > 1 ? <Link href={href(page - 1)} className={cx(btn, "text-head hover:bg-white/70")} rel="prev"><ChevronLeft className="size-4" strokeWidth={1.7} />Назад</Link> : <span className={cx(btn, "text-ink-4")} aria-disabled="true"><ChevronLeft className="size-4" strokeWidth={1.7} />Назад</span>}
      <span className="num text-[13px] text-ink-3">Страница {Math.min(page, pages)} из {pages}</span>
      {page < pages ? <Link href={href(page + 1)} className={cx(btn, "text-head hover:bg-white/70")} rel="next">Дальше<ChevronRight className="size-4" strokeWidth={1.7} /></Link> : <span className={cx(btn, "text-ink-4")} aria-disabled="true">Дальше<ChevronRight className="size-4" strokeWidth={1.7} /></span>}
    </nav>
  );
}
