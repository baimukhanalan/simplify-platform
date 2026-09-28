import { notFound } from "next/navigation";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { view } from "@/lib/payments/kaspi";
import { Logo } from "@/components/ui";
import { KaspiCheckout } from "./checkout";

export const metadata = { title: "Оплата кампании", robots: { index: false } };

export default async function KaspiPayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const p = await db.payment.findFirst({ where: { externalId: id, userId: user.id } });
  if (!p) notFound();
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col px-4 py-8 sm:py-14">
      <div className="flex items-center justify-between">
        <Link href="/app/campaign"><Logo /></Link>
        <Link href="/app/campaign" className="text-[13px] text-ink-3 hover:text-head">Отменить</Link>
      </div>
      <KaspiCheckout initial={view(p)} goal={user.goal?.primaryRole ?? ""} />
    </main>
  );
}
