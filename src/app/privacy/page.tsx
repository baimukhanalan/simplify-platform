import type { Metadata } from "next";
import { LegalPage } from "../_components/legal-page";
import { LEGAL_DOCS } from "@/lib/legal";
import { privacyContent } from "./content";

export const metadata: Metadata = { title: LEGAL_DOCS.privacy.title, description: "Как Simplify собирает, использует, хранит и защищает персональные данные — по Закону РК «О персональных данных и их защите»." };

export default function Privacy() {
  return <LegalPage doc="privacy" {...privacyContent()} />;
}
