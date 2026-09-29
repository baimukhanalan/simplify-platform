import { LegalPage, legalMetadata } from "../_components/legal-doc-page";
import { refundContent } from "./content";

export const generateMetadata = () => legalMetadata("refund");

export default function RefundPage() {
  return <LegalPage doc="refund" {...refundContent()} />;
}
