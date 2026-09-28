import "server-only";
import { db, j } from "@/lib/db";
import type { FitCandidate } from "./fit";

type UserWith = {
  id: string;
  profile: { yearsExperience: number; summary: string; headline: string; needsSponsorship: boolean } | null;
  goal: { seniority: string; workModes: string; industries: string } | null;
};

/** What "Why this fits" compares each vacancy against: goal + profile + employment history. */
export async function fitCandidate(user: UserWith): Promise<FitCandidate> {
  const facts = await db.fact.findMany({ where: { userId: user.id, kind: { in: ["employment", "project"] } }, select: { title: true, org: true, details: true } });
  return {
    yearsExperience: user.profile?.yearsExperience ?? 0,
    seniority: user.goal?.seniority ?? "junior",
    workModes: j<string[]>(user.goal?.workModes, ["remote"]),
    industries: j<string[]>(user.goal?.industries, []),
    needsSponsorship: user.profile?.needsSponsorship ?? true,
    background: [user.profile?.summary, user.profile?.headline, ...facts.map((f) => `${f.title} ${f.org} ${f.details}`)].filter(Boolean).join(" \n"),
  };
}
