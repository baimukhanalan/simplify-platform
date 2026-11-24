"use server";
import { headers } from "next/headers";
import { clientIpFrom } from "../rate-limit";
import { submitLeadCore, type LeadResult } from "../leads";
import { entryLocale } from "../i18n/server";
import { DEFAULT_LOCALE } from "../i18n/config";

export type ApplyState = LeadResult | undefined;

/** Public /apply form. Answers with codes only (fields → apply.err.*, rate/server → apply.errRate / errServer). */
export async function submitApplication(_: ApplyState, form: FormData): Promise<ApplyState> {
  const h = await headers();
  const locale = await entryLocale().catch(() => DEFAULT_LOCALE);
  return submitLeadCore(form, { ip: clientIpFrom(h), userAgent: h.get("user-agent") ?? "", locale });
}
