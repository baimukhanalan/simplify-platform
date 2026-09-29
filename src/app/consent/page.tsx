import { LegalPage, legalMetadata } from "../_components/legal-doc-page";
import { consentContent } from "./content";

export const generateMetadata = () => legalMetadata("consent");

export default function ConsentPage() {
  return <LegalPage doc="consent" {...consentContent()} />;
}
