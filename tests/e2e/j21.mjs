// Journey 21 (shared dev server): Settings — Telegram connect (simulated channel) → connected, ping, toggle, unlink;
// Web Push card renders; language switch ru → kk → en (pages render in that language — untranslated Russian segments are
// reported); legal-consent banner for an existing account without the current acceptance → accept once (idempotent).
//   BASE=http://localhost:3500 node tests/e2e/j21.mjs
import { Client, db, check, dbUser, visText, textProblems, getStable, done, sleep } from "./lib-dev.mjs";

const DAY = 86400000;
const u = await dbUser("settings", { name: "Айгерим Сапарова" });
await db.campaign.create({ data: { userId: u.id, plan: "local", priceKzt: 29990, status: "active", startedAt: new Date(Date.now() - 3 * DAY), endsAt: new Date(Date.now() + 57 * DAY) } });
const c = await new Client("settings").asUser(u.id);

// ——— Telegram ———
const s0 = await getStable(c, "/app/settings");
const t0 = visText(s0.text);
check(s0.status === 200 && /Telegram/.test(t0), "J21.settings", "settings renders with the Telegram card", s0.status);
check(!/скоро/i.test(t0.match(/Telegram.{0,200}/)?.[0] ?? ""), "J21.tg.notsoon", "Telegram card is connectable (not «скоро») in simulation", t0.match(/Telegram.{0,200}/)?.[0]);
const ping0 = await c.action("telegram.pingTelegram", [], { page: "/app/settings" });
check(ping0.result?.error, "J21.tg.ping.unlinked", "ping before linking → error", ping0.result);
const st = await c.action("telegram.startTelegramLink", [], { page: "/app/settings" });
check(st.result?.state?.pending && st.result.state.linked === false, "J21.tg.start", "startTelegramLink → pending", st.result ?? st.error);
const early = await c.action("telegram.pollTelegramLink", [], { page: "/app/settings" });
check(early.result?.state?.linked === false, "J21.tg.early", "poll right away → still waiting", early.result);
await sleep(2500);
// two tabs polling at once: exactly one link event
const [p1, p2] = await Promise.all([c.action("telegram.pollTelegramLink", [], { page: "/app/settings" }), c.action("telegram.pollTelegramLink", [], { page: "/app/settings" })]);
check(p1.result?.state?.linked && p2.result?.state?.linked, "J21.tg.linked", "poll after ~2.5 s → linked (both tabs)", [p1.result, p2.result]);
const linkEvents = await db.event.count({ where: { userId: u.id, type: "telegram", message: { contains: "подключён" } } });
check(linkEvents === 1, "J21.tg.once", "one «Telegram подключён» event despite concurrent polls", linkEvents);
const s1 = visText((await getStable(c, "/app/settings")).text);
check(/Подключ[её]н/.test(s1.match(/Telegram.{0,200}/)?.[0] ?? ""), "J21.tg.card", "card shows «Подключён»", s1.match(/Telegram.{0,200}/)?.[0]);
const ping = await c.action("telegram.pingTelegram", [], { page: "/app/settings" });
check(ping.result?.ok === true, "J21.tg.ping", "ping linked (sim) chat → ok", ping.result);
const off = await c.action("telegram.setTelegramEnabled", [false], { page: "/app/settings" });
check(off.result?.state?.enabled === false, "J21.tg.off", "notifications toggle off", off.result);
const n1 = await db.notification.create({ data: { userId: u.id, type: "info", title: "x" } });
const bad = await c.action("telegram.setTelegramEnabled", ["yes"], { page: "/app/settings" });
check(bad.result?.error, "J21.tg.zod", "non-boolean toggle rejected", bad.result);
await c.action("telegram.setTelegramEnabled", [true], { page: "/app/settings" });
const un = await c.action("telegram.unlinkTelegram", [], { page: "/app/settings" });
check(un.result?.state?.linked === false && !(await db.user.findUnique({ where: { id: u.id } })).telegramChatId, "J21.tg.unlink", "unlink → not linked", un.result);
await db.notification.delete({ where: { id: n1.id } });

// ——— Web Push card ———
check(/Push/i.test(t0), "J21.push", "Push card present in settings", t0.match(/.{0,60}Push.{0,120}/)?.[0]);
const pushSoon = /Push-уведомления\s*скоро/i.test(t0);
check(!pushSoon, "J21.push.configured", "VAPID keys set → push card is the interactive one (not «скоро»)", t0.match(/.{0,60}Push.{0,120}/)?.[0]);
const subBad = await c.json("POST", "/api/push/subscribe", { endpoint: "http://evil.example/x", keys: {} });
check(subBad.status >= 400 && subBad.status < 500, "J21.push.validate", "invalid push subscription rejected with 4xx", subBad);

// ——— locale ru → kk → en ———
const PAGES = ["/app", "/app/settings", "/app/applications", "/app/interviews", "/app/campaign", "/app/referral", "/app/inbox", "/app/offers", "/"];
const segments = (html) => html.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<style[\s\S]*?<\/style>/g, "").replace(/<!-- -->/g, "").split(/<[^>]+>/).map((s) => s.replace(/&nbsp;|&#160;/g, " ").replace(/\s+/g, " ").trim()).filter((s) => /[А-Яа-яЁё]{3,}/.test(s));
const USERDATA = /Айгерим|Сапарова/;
const ru = {};
for (const p of PAGES) ru[p] = segments((await getStable(c, p)).text);
const report = {};
for (const loc of ["kk", "en"]) {
  const r = await c.action("locale.setLocale", [loc], { page: "/app/settings" });
  check(r.result?.ok === true, `J21.locale.${loc}`, `setLocale(${loc})`, r.result ?? r.error);
  check(c.cookies.locale === loc && (await db.user.findUnique({ where: { id: u.id } })).locale === loc, `J21.locale.${loc}.saved`, "cookie + User.locale saved", c.cookies.locale);
  report[loc] = {};
  for (const p of PAGES) {
    const res = await getStable(c, p);
    check(res.status === 200, `J21.locale.${loc}.page`, `${p} renders in ${loc}`, res.status);
    check(new RegExp(`<html[^>]*lang="${loc}"`).test(res.text), `J21.locale.${loc}.lang`, `${p} <html lang="${loc}">`, res.text.match(/<html[^>]*>/)?.[0]);
    for (const prob of textProblems(res.text)) check(false, `J21.locale.${loc}.text`, `${p} visible text`, prob);
    const segs = segments(res.text).filter((s) => !USERDATA.test(s));
    // kk: a segment identical to the Russian rendering is untranslated; en: any Cyrillic segment is.
    const untranslated = loc === "en" ? segs : segs.filter((s) => ru[p].includes(s) && !/[әғқңөұүһі]/i.test(s));
    report[loc][p] = { untranslated: untranslated.length, total: segs.length, sample: [...new Set(untranslated)].slice(0, 6) };
  }
}
console.log("  untranslated Russian segments per page:");
for (const [loc, pages] of Object.entries(report)) for (const [p, v] of Object.entries(pages)) console.log(`   ${loc} ${p}: ${v.untranslated}/${v.total}  ${JSON.stringify(v.sample).slice(0, 400)}`);
for (const loc of ["kk", "en"]) {
  const anon = new Client("anon-" + loc);
  anon.cookies.locale = loc;
  const lp = await getStable(anon, "/login");
  const segs = segments(lp.text);
  check(lp.status === 200 && new RegExp(`<html[^>]*lang="${loc}"`).test(lp.text), `J21.locale.${loc}.login`, `/login (signed out, locale cookie) renders in ${loc}`, lp.text.match(/<html[^>]*>/)?.[0]);
  console.log(`   ${loc} /login (anon): ${loc === "en" ? segs.length : "-"} Cyrillic segments ${JSON.stringify(segs.slice(0, 6)).slice(0, 300)}`);
}
const badLocale = await c.action("locale.setLocale", ["de"], { page: "/app/settings" });
check(badLocale.result?.ok === false, "J21.locale.invalid", "setLocale(de) rejected", badLocale.result);
await c.action("locale.setLocale", ["ru"], { page: "/app/settings" });

// ——— legal consent banner (existing account without the current acceptance) ———
const old = await dbUser("legacy", { consents: JSON.stringify({ terms: true, autoSubmit: true }) });
const lc = await new Client("legacy").asUser(old.id);
const b0 = visText((await getStable(lc, "/app")).text);
check(/Мы обновили документы/.test(b0), "J21.legal.banner", "banner shown to an account without legal acceptance");
const [a1, a2] = await Promise.all([lc.action("legal.acceptLegal", [], { page: "/app" }), lc.action("legal.acceptLegal", [], { page: "/app" })]);
check(a1.result?.ok && a2.result?.ok, "J21.legal.accept", "acceptLegal (double click) → ok", [a1.result, a2.result]);
const ev = await db.event.count({ where: { userId: old.id, type: "legal_accepted" } });
check(ev === 1, "J21.legal.once", "exactly one legal_accepted event", ev);
const cons = JSON.parse((await db.user.findUnique({ where: { id: old.id } })).consents);
check(cons.autoSubmit === true && cons.legal?.terms, "J21.legal.merge", "acceptance merged, other consents kept", cons);
const b1 = visText((await getStable(lc, "/app")).text);
check(!/Мы обновили документы/.test(b1), "J21.legal.gone", "banner gone after accepting");
const fresh = visText((await getStable(c, "/app")).text);
check(!/Мы обновили документы/.test(fresh), "J21.legal.none", "no banner for an account that accepted at signup-equivalent");

await done();
