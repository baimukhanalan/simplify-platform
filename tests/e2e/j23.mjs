// Journey 23 (shared dev server): interview guarantee. A campaign past endsAt without any interview → opening /app extends
// it by 30 days (endsAt, bonusDays, guaranteeStatus) with exactly one notification; the same under 25 concurrent page
// loads + an agent cycle racing them; a campaign that had an interview is NOT extended (expires instead).
//   BASE=http://localhost:3500 node tests/e2e/j23.mjs
import { Client, db, check, dbUser, visText, textProblems, getStable, done, engineAsync } from "./lib-dev.mjs";

const DAY = 86400000;
async function overdue(label, { interview = false } = {}) {
  const u = await dbUser(label, { name: "Мадина Касымова" });
  const endsAt = new Date(Date.now() - 2 * 3600_000);
  const camp = await db.campaign.create({ data: { userId: u.id, plan: "local", priceKzt: 29990, status: "active", startedAt: new Date(endsAt.getTime() - 60 * DAY), endsAt } });
  let job;
  if (interview) {
    job = await db.job.create({ data: { source: "demo", externalId: "e2e", dedupeKey: `e2e-test-g-${Date.now()}-${Math.random()}`, company: "Steppe Data", title: "Analyst", postedAt: new Date(endsAt.getTime() - 50 * DAY) } });
    await db.opportunity.create({ data: { campaignId: camp.id, jobId: job.id, status: "recruiter", submittedAt: new Date(endsAt.getTime() - 40 * DAY) } });
  }
  return { u, camp, endsAt, job, c: await new Client(label).asUser(u.id) };
}
const titleRe = /продлили кампанию на 30 дней/;

// 1 · single user, one page load
{
  const { u, camp, endsAt, c } = await overdue("guar1");
  const r = await getStable(c, "/app");
  check(r.status === 200, "J23.app", "/app renders for the overdue campaign", r.status);
  const cc = await db.campaign.findUnique({ where: { id: camp.id } });
  check(cc.guaranteeStatus === "extended" && Math.abs(cc.endsAt - Math.max(+endsAt, Date.now()) - 30 * DAY) < 10 * 60_000 && cc.bonusDays === 30 && cc.status === "active", "J23.extended", "campaign extended to max(endsAt, now) + 30 days, still active", { st: cc.guaranteeStatus, days: (cc.endsAt - endsAt) / DAY, bonus: cc.bonusDays, status: cc.status });
  const notes = await db.notification.findMany({ where: { userId: u.id } });
  check(notes.filter((n) => titleRe.test(n.title)).length === 1, "J23.notify", "exactly one guarantee notification", notes.map((n) => n.title));
  const t = visText(r.text);
  check(/продл/i.test(t), "J23.banner", "Today tells about the extension", t.match(/.{0,80}продл.{0,120}/i)?.[0]);
  for (const prob of textProblems(r.text)) check(false, "J23.text", "/app visible text", prob);
  const cp = await getStable(c, "/app/campaign");
  check(cp.status === 200 && /гарант/i.test(visText(cp.text)), "J23.campaignpage", "campaign page shows the guarantee state", visText(cp.text).match(/.{0,80}гарант.{0,120}/i)?.[0]);
  await getStable(c, "/app");
  const again = await db.campaign.findUnique({ where: { id: camp.id } });
  check(+again.endsAt === +cc.endsAt && (await db.notification.count({ where: { userId: u.id, title: { contains: "продлили" } } })) === 1, "J23.once", "reload doesn't extend again");
}

// 2 · concurrency: 25 page loads (different screens) + an agent cycle at the same moment
{
  const { u, camp, endsAt, c } = await overdue("guar2");
  const paths = ["/app", "/app/campaign", "/app/applications", "/app/interviews", "/app/settings"];
  const tickP = engineAsync("tick", camp.id, "1");
  const loads = await Promise.all(Array.from({ length: 25 }, (_, i) => c.get(paths[i % paths.length])));
  const tick = await tickP;
  const s = loads.map((l) => l.status);
  check(s.every((x) => x === 200), "J23.conc.status", "25 concurrent loads all 200", s.join(","));
  const cc = await db.campaign.findUnique({ where: { id: camp.id } });
  check(Math.abs(cc.endsAt - Math.max(+endsAt, Date.now()) - 30 * DAY) < 10 * 60_000 && cc.bonusDays === 30, "J23.conc.once", "extended exactly once under concurrency", { days: (cc.endsAt - endsAt) / DAY, bonus: cc.bonusDays, tick: JSON.stringify(tick).slice(0, 120) });
  const n = await db.notification.count({ where: { userId: u.id, title: { contains: "продлили" } } });
  const ev = await db.event.count({ where: { userId: u.id, type: "campaign_guarantee" } });
  check(n === 1 && ev === 1, "J23.conc.notify", "one notification + one journal event", { n, ev });
}

// 3 · had an interview → not extended
{
  const { camp, c, job } = await overdue("guar3", { interview: true });
  await getStable(c, "/app");
  const cc = await db.campaign.findUnique({ where: { id: camp.id } });
  check(cc.guaranteeStatus === "" && cc.bonusDays === 0, "J23.noext", "campaign with an interview is not extended", { st: cc.guaranteeStatus, bonus: cc.bonusDays, status: cc.status });
  await db.opportunity.deleteMany({ where: { jobId: job.id } });
  await db.job.delete({ where: { id: job.id } });
}
await done();
