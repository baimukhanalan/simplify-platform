import "server-only";
// /status — a short campaign summary for the bot: day X of Y, applications, interviews, offers.
import { db } from "../db";
import { currentCampaign, interviewCounts, visibleScope } from "../ops-data";
import { campaignDay } from "@/app/app/_components/today-data";
import { count, type Forms } from "../ru";
import { esc } from "./format";

const APPS: Forms = ["заявка", "заявки", "заявок"];
const IVS: Forms = ["интервью", "интервью", "интервью"];
const TASKS: Forms = ["тестовое задание", "тестовых задания", "тестовых заданий"];
const OFFERS: Forms = ["оффер", "оффера", "офферов"];

const STATUS_RU: Record<string, string> = { active: "идёт", paused: "на паузе", hired: "завершена — HIRED 🏆", expired: "завершена" };

export async function statusText(userId: string, now = new Date()) {
  const campaign = await currentCampaign(userId);
  if (!campaign) return "📋 Кампания ещё не запущена.\n\nЗапусти её в Simplify — агент начнёт искать роли и отправлять заявки.";
  const [submitted, iv, offers] = await Promise.all([
    db.opportunity.count({ where: { campaignId: campaign.id, ...visibleScope(), submittedAt: { not: null } } }),
    interviewCounts(userId, now),
    db.offer.count({ where: { userId, opportunity: { campaignId: campaign.id, ...visibleScope() } } }),
  ]);
  const running = campaign.status === "active" || campaign.status === "paused";
  const { day, total } = campaignDay(campaign, now.getTime());
  const lines = [
    `📋 <b>Кампания ${esc(STATUS_RU[campaign.status] ?? campaign.status)}</b>`,
    running ? `День ${day} из ${total}` : "",
    "",
    `📨 Отправлено: ${count(submitted, APPS)}`,
    `🗓 Впереди: ${count(iv.upcoming, IVS)}${iv.completed ? ` · прошло: ${iv.completed}` : ""}`,
    iv.assessments ? `📝 Открыто: ${count(iv.assessments, TASKS)}` : "",
    offers ? `🎉 ${count(offers, OFFERS)}` : "",
  ];
  return lines.filter((l, i) => l !== "" || i === 2).join("\n");
}
