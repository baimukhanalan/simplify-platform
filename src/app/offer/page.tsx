import type { Metadata } from "next";
import { LegalPage } from "../_components/legal-page";
import { LEGAL_DOCS } from "@/lib/legal";
import { offerContent } from "./content";

export const metadata: Metadata = { title: LEGAL_DOCS.offer.title, description: "Договор возмездного оказания услуг Simplify: тарифы, оплата через Kaspi Pay, гарантия, реферальная программа, возвраты." };

export default function OfferPage() {
  return <LegalPage doc="offer" {...offerContent()} />;
}
