"use server";
// Demo tools with a result line: wrap the campaign actions and report what actually changed.
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { runAgentNow, simulateEmployers } from "@/lib/actions/campaign";
import { count } from "../../_components/ru";

export type DemoResult = { ok: boolean; message: string; at: number };

const lastTick = (userId: string) => db.event.findFirst({ where: { userId, type: "tick" }, orderBy: { createdAt: "desc" }, select: { id: true, message: true } });

/** One agent cycle now. The engine writes a "tick" event per cycle; no new one means the cycle did not run. */
export async function runAgentWithResult(): Promise<DemoResult> {
  const user = await requireUser();
  const before = await lastTick(user.id);
  await runAgentNow();
  const after = await lastTick(user.id);
  if (after && after.id !== before?.id) return { ok: true, message: `Агент провёл цикл. ${after.message.replace(/^Цикл агента:\s*/, "")}`.trim(), at: Date.now() };
  return { ok: false, message: "Цикл не запустился: кампания не активна или лимит ручных запусков на этот час исчерпан. Агент продолжит по расписанию.", at: Date.now() };
}

/** Simulated employer replies for demo vacancies; says how many letters arrived. */
export async function simulateWithResult(): Promise<DemoResult> {
  const user = await requireUser();
  const where = { userId: user.id };
  const before = await db.inboxMessage.count({ where });
  await simulateEmployers();
  const n = (await db.inboxMessage.count({ where })) - before;
  return n > 0
    ? { ok: true, message: `Пришло ${count(n, ["новое письмо", "новых письма", "новых писем"])} от работодателей — агент уже разобрал ${n === 1 ? "его" : "их"}.`, at: Date.now() }
    : { ok: false, message: "Новых ответов нет: симуляция отвечает только по отправленным демо-заявкам.", at: Date.now() };
}
