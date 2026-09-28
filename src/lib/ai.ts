import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";

/**
 * Claude is optional. With ANTHROPIC_API_KEY set, generation (CV variants, cover letters,
 * interview packs, mock feedback) goes through Claude; otherwise every call site supplies a
 * deterministic engine fallback so the platform works fully offline.
 */
export const MODEL = process.env.SIMPLIFY_MODEL ?? "claude-opus-5";
export const aiEnabled = () => Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);

let client: Anthropic | null = null;
const getClient = () => (client ??= new Anthropic());

export const BASE_RULES = `You work inside Simplify, an AI career agent. Build everything from the candidate's profile data. Write concisely, with concrete verbs and measurable results where the profile has them.`;

export async function aiJSON<S extends z.ZodType>(opts: {
  schema: S;
  system: string;
  prompt: string;
  fallback: () => z.infer<S> | Promise<z.infer<S>>;
  effort?: "low" | "medium" | "high";
}): Promise<{ data: z.infer<S>; by: "claude" | "engine" }> {
  if (!aiEnabled()) return { data: await opts.fallback(), by: "engine" };
  try {
    const res = await getClient().messages.parse({
      model: MODEL,
      max_tokens: 16000,
      system: `${BASE_RULES}\n\n${opts.system}`,
      output_config: { format: zodOutputFormat(opts.schema), effort: opts.effort ?? "medium" },
      messages: [{ role: "user", content: opts.prompt }],
    });
    if (res.stop_reason === "refusal" || !res.parsed_output) throw new Error(`no parsed output (${res.stop_reason})`);
    return { data: res.parsed_output as z.infer<S>, by: "claude" };
  } catch (err) {
    console.error("[ai] falling back to engine:", err instanceof Error ? err.message : err);
    return { data: await opts.fallback(), by: "engine" };
  }
}

export async function aiText(opts: { system: string; prompt: string; fallback: () => string; effort?: "low" | "medium" | "high" }) {
  if (!aiEnabled()) return { text: opts.fallback(), by: "engine" as const };
  try {
    const res = await getClient().messages.create({
      model: MODEL,
      max_tokens: 4000,
      system: `${BASE_RULES}\n\n${opts.system}`,
      output_config: { effort: opts.effort ?? "low" },
      messages: [{ role: "user", content: opts.prompt }],
    });
    const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n").trim();
    if (!text) throw new Error(`empty (${res.stop_reason})`);
    return { text, by: "claude" as const };
  } catch (err) {
    console.error("[ai] falling back to engine:", err instanceof Error ? err.message : err);
    return { text: opts.fallback(), by: "engine" as const };
  }
}
