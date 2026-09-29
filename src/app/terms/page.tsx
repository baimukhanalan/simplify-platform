import { LegalPage, legalMetadata } from "../_components/legal-doc-page";
import { termsContent } from "./content";

export const generateMetadata = () => legalMetadata("terms");

export default function TermsPage() {
  return <LegalPage doc="terms" {...termsContent()} />;
}
