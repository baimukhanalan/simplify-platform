// Translator for server actions and route handlers whose messages the UI shows as-is (errors, notes).
// Inside a request: the request's language (getT). Outside one (tests, scripts, cron): Russian, the source language — so
// a message never throws and never comes back as a raw key. ./server (cookies, session, DB) is loaded lazily, so this
// module is safe to import anywhere on the server, including code that unit tests load directly.
import "server-only";
import { DEFAULT_LOCALE } from "./config";
import { DICTIONARIES } from "./dictionaries";
import { createTranslator, type T } from "./translator";

export async function actionT(): Promise<T> {
  try {
    const { getT } = await import("./server");
    return await getT();
  } catch {
    return createTranslator(DEFAULT_LOCALE, DICTIONARIES[DEFAULT_LOCALE]);
  }
}
