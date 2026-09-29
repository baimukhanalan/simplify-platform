import { confirmInvoicePayment } from "@/lib/payments/confirm";

export const maxDuration = 60;

/** The customer confirms payment of an invoice in the Kaspi checkout (see confirmInvoicePayment). Owner-only. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return confirmInvoicePayment(req, id);
}
