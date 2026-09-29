// Which package screening answers the extension may put into a form on its own. Pure — unit-tested.
// Only answers that are ready (filled by a rule/engine, or approved/edited by the user) and non-empty. Sensitive, legal and
// EEO questions are NEVER handed to the extension for filling, even when the user answered them in Approvals: the extension
// lists them as "fill yourself" so the user makes that declaration on the employer's form in person.
import type { Answer } from "@/lib/engine/personalize";

/** Question kinds the extension never fills. */
export const HELD_KINDS = new Set(["sensitive", "legal"]);

/** EEO / legal / consent wording — held regardless of the stored kind (the same regex idea runs in the content script). */
export const SENSITIVE_RE =
  /\b(gender|sex|pronouns?|race|racial|ethnic(ity)?|hispanic|latin[oa]|veteran|disabilit(y|ies)|sexual orientation|transgender|religio(n|us)|date of birth|birth ?date|marital|criminal|convict(ed|ion)?|felony|misdemeanou?r|background check|drug (test|screen)|self[- ]identif\w*|consent|certify|attest|signature|social security|ssn|passport)\b|(^|[^а-яё])пол([^а-яё]|$)|национальност|инвалидност|судимост|вероисповедан|дата рождения|согласи[ея]/i;

export type ExtensionAnswer = { q: string; a: string; review: boolean };
export type HeldQuestion = { q: string; reason: "sensitive" | "legal" | "pending" };

/** Answers worth a second look before sending (the extension fills them but marks the field «проверь»). */
const REVIEW_KINDS = new Set(["salary", "sponsorship"]);

export function splitAnswers(answers: Answer[]): { answers: ExtensionAnswer[]; held: HeldQuestion[] } {
  const ok: ExtensionAnswer[] = [];
  const held: HeldQuestion[] = [];
  for (const x of Array.isArray(answers) ? answers : []) {
    if (!x || typeof x.q !== "string") continue;
    const q = x.q.trim();
    if (!q) continue;
    if ((x.kind && HELD_KINDS.has(x.kind)) || SENSITIVE_RE.test(q)) {
      held.push({ q, reason: x.kind === "legal" ? "legal" : "sensitive" });
      continue;
    }
    const a = typeof x.a === "string" ? x.a.trim() : "";
    if ((x.status !== "filled" && x.status !== "approved") || !a) {
      held.push({ q, reason: "pending" });
      continue;
    }
    ok.push({ q, a, review: Boolean(x.kind && REVIEW_KINDS.has(x.kind)) });
  }
  return { answers: ok, held };
}
