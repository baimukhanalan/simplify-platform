import "server-only";
import { aiJSON } from "../ai";
import { PackSchema, buildPackHeuristic } from "./interview";

export async function buildPack(ctx: Parameters<typeof buildPackHeuristic>[0]) {
  return aiJSON({
    schema: PackSchema,
    system: "Create a personalized interview preparation pack for this round. Behavioral answers must use ONLY the provided verified STAR stories (reference them by title). Questions to ask: 5–8, specific to the company and role. Keep each item short and speakable.",
    prompt: JSON.stringify(ctx).slice(0, 40000),
    fallback: () => buildPackHeuristic(ctx),
  });
}

