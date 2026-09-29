import "server-only";
import type { OutgoingNotification } from "./index";

/** Web Push channel — implemented in the PWA workstream. Never throws. */
export async function deliverWebPush(_n: OutgoingNotification): Promise<void> {}
