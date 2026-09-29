import { confirmInvoicePayment } from "@/lib/payments/confirm";

export const maxDuration = 60;

/** Older alias of POST /api/payments/kaspi/confirm/[id] (same logic, old error strings); kept for clients still calling it. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return confirmInvoicePayment(req, id, { legacyErrors: true });
}
