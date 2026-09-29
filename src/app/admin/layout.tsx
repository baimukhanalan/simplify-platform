import Link from "next/link";
import { ArrowLeft, LogOut } from "lucide-react";
import { requireAdmin } from "@/lib/auth";
import { logout } from "@/lib/actions/auth";
import { Chip, Logo } from "@/components/ui";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireAdmin();
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-40 border-b border-line bg-mint-2/80 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-[1180px] items-center gap-3 px-4 sm:px-8">
          <Link href="/app" className="inline-flex min-h-10 shrink-0 items-center rounded focus-visible:outline-2 focus-visible:outline-green"><Logo /></Link>
          <Chip tone="dark" className="hidden sm:inline-flex">Operations</Chip>
          <span className="flex-1" />
          <Link href="/app" className="flex h-10 items-center gap-1.5 rounded-full px-3 text-[13px] text-ink-2 hover:bg-white/60 focus-visible:outline-2 focus-visible:outline-green">
            <ArrowLeft className="size-3.5" strokeWidth={1.7} /><span className="hidden sm:inline">В приложение</span><span className="sm:hidden">Назад</span>
          </Link>
          <span className="hidden text-[13px] text-ink-3 md:inline">{user.name}</span>
          <form action={logout}>
            <button className="grid size-9 place-items-center rounded-full glass text-teal hover:text-head focus-visible:outline-2 focus-visible:outline-green" aria-label="Выйти" title="Выйти"><LogOut className="size-4" strokeWidth={1.7} /></button>
          </form>
        </div>
      </header>
      <main className="mx-auto w-full max-w-[1180px] px-4 pb-16 pt-8 sm:px-8">{children}</main>
    </div>
  );
}
