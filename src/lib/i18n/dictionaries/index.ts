// All three dictionaries. Server only: client components receive one language's slice through <I18nScope>.
import "server-only";
import type { Locale } from "../config";
import { ru, type Dictionary } from "./ru";
import { kk } from "./kk";
import { en } from "./en";

export const DICTIONARIES: Record<Locale, Dictionary> = { ru, kk, en };
