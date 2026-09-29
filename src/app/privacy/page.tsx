import { LegalPage, legalMetadata } from "../_components/legal-doc-page";
import { privacyContent } from "./content";

export const generateMetadata = () => legalMetadata("privacy");

export default function PrivacyPage() {
  return <LegalPage doc="privacy" {...privacyContent()} />;
}
