import type { Metadata } from "next";
import { LegalPage } from "../_components/legal-page";
import { LEGAL_DOCS } from "@/lib/legal";
import { termsContent } from "./content";

export const metadata: Metadata = { title: LEGAL_DOCS.terms.title, description: "Правила использования сервиса Simplify: аккаунт, работа ИИ-агента, Copilot, оплата и ответственность." };

export default function Terms() {
  return <LegalPage doc="terms" {...termsContent()} />;
}
