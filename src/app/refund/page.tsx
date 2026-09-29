import type { Metadata } from "next";
import { LegalPage } from "../_components/legal-page";
import { LEGAL_DOCS } from "@/lib/legal";
import { refundContent } from "./content";

export const metadata: Metadata = { title: LEGAL_DOCS.refund.title, description: "Когда и как вернуть деньги за кампанию Simplify, оплаченную через Kaspi Pay." };

export default function RefundPage() {
  return <LegalPage doc="refund" {...refundContent()} />;
}
