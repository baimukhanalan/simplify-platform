import type { Metadata } from "next";
import { LegalPage } from "../_components/legal-page";
import { LEGAL_DOCS } from "@/lib/legal";
import { consentContent } from "./content";

export const metadata: Metadata = { title: LEGAL_DOCS.consent.title, description: "Текст согласия на сбор и обработку персональных данных пользователя Simplify." };

export default function ConsentPage() {
  return <LegalPage doc="consent" {...consentContent()} />;
}
