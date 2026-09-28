// Small display helpers shared by Opportunities, Applications, Inbox and Approvals. Pure: safe on server and client.
import { ago } from "@/lib/ops";
import { WORK_MODE_RU, plural } from "../../../_components/ru";

const DAY = 86400000;
const dayKey = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Asia/Almaty" });

/**
 * Relative time without the clipped "дн." form: «только что», «5 мин. назад», «3 ч назад», «вчера», «4 дня назад»,
 * then a date. Minutes and hours stay as `ago` writes them.
 */
export function agoRu(date: Date | null | undefined, now: number = Date.now()) {
  if (!date) return "—";
  const diff = now - date.getTime();
  const days = (n: number) => `${n} ${plural(n, ["день", "дня", "дней"])}`;
  if (diff < 0) {
    const d = Math.round(-diff / DAY);
    return d >= 1 && d < 30 ? `через ${days(d)}` : ago(date, now);
  }
  if (diff < DAY) {
    // Yesterday evening, seen this morning, reads as «вчера» rather than «14 ч назад».
    if (dayKey(date) !== dayKey(new Date(now)) && diff >= 6 * 3600000) return "вчера";
    return ago(date, now);
  }
  const d = Math.round(diff / DAY);
  if (d <= 1) return "вчера";
  if (d < 30) return `${days(d)} назад`;
  return ago(date, now);
}

/** Work format in Russian (remote / hybrid / onsite → «Удалённо» / «Гибрид» / «Офис»). */
export const workModeRu = (mode: string) => WORK_MODE_RU[mode] ?? mode;

const PLACE_RU: [RegExp, string][] = [
  [/\bremote\b/gi, "Удалённо"],
  [/\bhybrid\b/gi, "Гибрид"],
  [/\bon-?site\b/gi, "Офис"],
  [/\bworldwide\b|\banywhere\b/gi, "весь мир"],
  [/\beurope\b/gi, "Европа"],
];

/**
 * Location plus work format without saying the format twice: "Remote — Europe" + remote → «Удалённо — Европа»
 * (no extra chip). `showMode` is false when the location already names the format.
 */
export function placeRu(location: string, mode: string) {
  const loc = PLACE_RU.reduce((s, [re, ru]) => s.replace(re, ru), location.trim());
  const modeRu = workModeRu(mode);
  const showMode = !loc || !loc.toLowerCase().includes(modeRu.toLowerCase());
  return { location: loc, mode: modeRu, showMode };
}
