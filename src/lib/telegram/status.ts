import "server-only";
// /status — a short campaign summary for the bot: day X of Y, applications, interviews, offers.
import { db } from "../db";
import { currentCampaign, interviewCounts, visibleScope } from "../ops-data";
import { campaignDay } from "@/app/app/_components/today-data";
import type { Locale } from "../i18n/config";
import { botT, esc } from "./format";

/** In the user's language (Russian by default). */
export async function statusText(userId: string, now = new Date(), locale?: Locale) {
  const t = botT(locale);
  const campaign = await currentCampaign(userId);
  if (!campaign) return t("telegramCard.bot.status.noCampaign");
  const [submitted, iv, offers] = await Promise.all([
    db.opportunity.count({ where: { campaignId: campaign.id, ...visibleScope(), submittedAt: { not: null } } }),
    interviewCounts(userId, now),
    db.offer.count({ where: { userId, opportunity: { campaignId: campaign.id, ...visibleScope() } } }),
  ]);
  const running = campaign.status === "active" || campaign.status === "paused";
  const { day, total } = campaignDay(campaign, now.getTime());
  const lines = [
    `📋 <b>${esc(t("telegramCard.bot.status.title", { status: campaign.status }))}</b>`,
    running ? t("telegramCard.bot.status.day", { day, total }) : "",
    "",
    t("telegramCard.bot.status.sent", { n: submitted }),
    `${t("telegramCard.bot.status.upcoming", { n: iv.upcoming })}${iv.completed ? t("telegramCard.bot.status.completed", { n: iv.completed }) : ""}`,
    iv.assessments ? t("telegramCard.bot.status.tasks", { n: iv.assessments }) : "",
    offers ? t("telegramCard.bot.status.offers", { n: offers }) : "",
  ];
  return lines.filter((l, i) => l !== "" || i === 2).join("\n");
}
