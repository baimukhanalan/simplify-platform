import { extractMetric } from "@/lib/engine/profile";

/** Suggestions pulled from the user's own mini-interview answers. Shown for confirmation — never applied silently. */
export function hintsFromAnswers(answers: string[]) {
  const text = answers.join("\n");
  const team = text.match(/(\d{1,4})\s*(?:человек|чел\.?|people|persons|members|инженер|аналитик|разработчик)/i)?.[1];
  const low = text.toLowerCase();
  const ownership = /(руководил|возглавил|вёл |вел |\bled\b|owned|принимал решения|сам принимал|сам решал)/.test(low)
    ? "led"
    : /(исполнял|выполнял|executed|по задачам|ставили задачи)/.test(low)
      ? "executed"
      : /(участвовал|помогал|contributed|в команде)/.test(low)
        ? "contributed"
        : "";
  // Keep only the clause that carries the number, not the whole sentence.
  const sentence = extractMetric(text);
  const metrics = sentence.split(/[,;]|\s(?:и|and)\s/).find((part) => /\d+(?:[.,]\d+)?\s?%|\$\s?\d|\d+x\b/.test(part))?.trim() ?? sentence;
  return { metrics, teamSize: team ? Number(team) : null, ownership };
}
