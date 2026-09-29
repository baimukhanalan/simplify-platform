import "server-only";
import type { OutgoingNotification } from "./index";

/** Telegram channel — implemented in the Telegram workstream. Never throws. */
export async function deliverTelegram(_n: OutgoingNotification): Promise<void> {}
