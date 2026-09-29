// Forwarding-verification letters. When a user adds <alias>@in.wesimplify.works as a forwarding address, Gmail (and Yandex /
// Mail.ru for their forwarding rules) first sends a letter with a code or a link to that address. It is not employer
// mail: we never classify it — we pull out the code/link and show it in the «Пересылка писем» card so the user can
// finish the setup. Pure (no DB).

export type VerifyProvider = "gmail" | "yandex" | "mailru" | "outlook";

export type ForwardingVerification = {
  provider: VerifyProvider;
  /** Numeric confirmation code (Gmail), or null. */
  code: string | null;
  /** Confirmation link in the provider's exact confirmation-URL shape (Gmail only), or null. */
  link: string | null;
  /** The mailbox that asked to forward (e.g. name@gmail.com), when the letter names it. */
  requester: string | null;
};

/**
 * `link`: the exact shape of the provider's confirmation URL. Only Gmail's is known for certain
 * (https://mail-settings.google.com/mail/vf-… , older letters: https://mail.google.com/mail/vf-…); for the others the card
 * shows the numeric code only — a letter can be forged, and the card must never offer an arbitrary link.
 */
const PROVIDERS: { provider: VerifyProvider; sender: RegExp; link: RegExp | null }[] = [
  { provider: "gmail", sender: /@(?:[\w-]+\.)*google\.com$/, link: /^https:\/\/(?:mail-settings|mail)\.google\.com\/mail\/(?:u\/\d\/)?vf-[A-Za-z0-9%_.~-]{1,1500}$/ },
  { provider: "yandex", sender: /@(?:[\w-]+\.)*yandex\.(?:ru|kz|com|by|ua|com\.tr)$|@ya\.ru$/, link: null },
  { provider: "mailru", sender: /@(?:[\w-]+\.)*(?:mail\.ru|corp\.mail\.ru|vk\.team)$/, link: null },
  { provider: "outlook", sender: /@(?:[\w-]+\.)*(?:microsoft\.com|outlook\.com|live\.com|hotmail\.com)$/, link: null },
];

const FORWARD = /forward|пересыл|переадрес/i;
const CONFIRM = /confirm|verif|подтвер/i;

/** Bare sender address from a From header ("Gmail Team <forwarding-noreply@google.com>" → forwarding-noreply@google.com). */
export function senderAddress(from: string) {
  const m = from.match(/<([^<>\s]+@[^<>\s]+)>/) ?? from.match(/([^\s<>"']+@[^\s<>"']+)/);
  return (m?.[1] ?? "").toLowerCase();
}

export function detectForwardingVerification(from: string, subject: string, text: string): ForwardingVerification | null {
  const sender = senderAddress(from);
  const p = PROVIDERS.find((x) => x.sender.test(sender));
  if (!p) return null;
  const head = `${subject}\n${text.slice(0, 20_000)}`;
  if (!FORWARD.test(head) || !CONFIRM.test(head)) return null;

  // Gmail: "(#123456789) Gmail Forwarding Confirmation…" / "Confirmation code: 123456789" / "Код подтверждения: 123456789".
  const code =
    subject.match(/\(#\s?(\d{6,12})\)/)?.[1] ??
    head.match(/(?:confirmation code|verification code|код подтверждения|код)\s*[:：]?\s*(\d{6,12})\b/i)?.[1] ??
    null;

  let link: string | null = null;
  if (p.link) {
    for (const m of head.matchAll(/https:\/\/[^\s<>"')\]]+/g)) {
      const candidate = m[0].replace(/[.,;]+$/, "");
      if (p.link.test(candidate)) {
        link = candidate;
        break;
      }
    }
  }
  if (!code && !link) return null;
  const requester =
    head.match(/(?:receive mail from|получение почты с адреса|почты с адреса)\s+([\w.%+-]+@[\w.-]+\.[a-z]{2,})/i)?.[1]?.toLowerCase() ??
    head.match(/([\w.%+-]+@[\w.-]+\.[a-z]{2,})\s+(?:has requested|запросил|хочет)/i)?.[1]?.toLowerCase() ??
    null;
  return { provider: p.provider, code, link, requester };
}

export const PROVIDER_RU: Record<VerifyProvider, string> = { gmail: "Gmail", yandex: "Яндекс Почта", mailru: "Почта Mail.ru", outlook: "Outlook" };
