import { LegalPage, legalMetadata } from "../_components/legal-doc-page";
import { offerContent } from "./content";

export const generateMetadata = () => legalMetadata("offer");

export default function OfferPage() {
  return <LegalPage doc="offer" {...offerContent()} />;
}
