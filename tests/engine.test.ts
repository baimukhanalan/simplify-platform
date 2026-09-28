// Unit tests for the pure engines.
// Run: npx tsx --conditions=react-server --test tests/*.test.ts
// (react-server condition makes `server-only` a no-op so modules that import ../ai load outside Next.)
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";

import { scoreJob, type CandidateCtx, type JobCtx } from "../src/lib/engine/matching";
import { assessReadiness, type ReadinessInput } from "../src/lib/engine/readiness";
import { classifyEmail } from "../src/lib/engine/inbox";
import { detectIntent, scaffold, type StoryLite, type FactLite as IvFact } from "../src/lib/engine/interview";
import { benchmarkOffer, negotiationPlan } from "../src/lib/engine/offer";
import { marketRange, percentileIn } from "../src/lib/engine/market";
import { parseCVHeuristic } from "../src/lib/engine/profile";
import { buildPackageHeuristic, type ProfileLite, type FactLite, type JobLite } from "../src/lib/engine/personalize";
import { segmentStats, type OppLite } from "../src/lib/engine/insights";

const NOW = new Date("2026-09-28T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86400000);

// ——— fixtures ———
const candidate = (over: Partial<CandidateCtx> = {}, goal: Partial<CandidateCtx["goal"]> = {}): CandidateCtx => ({
  skills: ["SQL", "Python", "Tableau", "Excel", "Statistics"],
  yearsExperience: 3,
  englishLevel: "B2",
  languages: ["English", "Russian", "Kazakh"],
  workAuth: ["KZ"],
  needsSponsorship: false,
  relocation: false,
  educationLevel: "bachelor",
  allocation: {},
  ...over,
  goal: {
    primaryRole: "Data Analyst", extraRoles: [], seniority: "middle", minSalary: 0, countries: ["KZ", "WORLD"],
    workModes: ["remote", "hybrid"], industries: [], dreamCompanies: [], blockedCompanies: [], mode: "balanced",
    ...goal,
  },
});

const job = (over: Partial<JobCtx> = {}): JobCtx => ({
  title: "Data Analyst", company: "Kaspi", roleFamily: "data_analyst", seniority: "middle", countries: ["KZ"], remote: "remote",
  salaryMin: null, salaryMax: null, technologies: ["SQL", "Python", "Tableau"], requirements: [], minYears: 2,
  education: "", workAuth: [], sponsorship: "unknown", languages: [], industry: "", massHiring: false, postedAt: daysAgo(0.5),
  ...over,
});

describe("matching.scoreJob", () => {
  test("well-matched remote KZ job is eligible with high match and positive P(interview)", () => {
    const r = scoreJob(candidate(), job(), NOW);
    assert.equal(r.eligibility, "eligible");
    assert.deepEqual(r.blockers, []);
    assert.ok(r.match >= 85, `match ${r.match}`);
    assert.ok(r.pInterview > 0);
  });

  test("hard blockers: onsite abroad with no sponsorship → blocked and P(interview) = 0", () => {
    const r = scoreJob(candidate({}, { countries: ["EU"], workModes: ["remote", "hybrid", "onsite"] }), job({ countries: ["DE"], remote: "onsite", sponsorship: "no" }), NOW);
    assert.equal(r.eligibility, "blocked");
    assert.ok(r.blockers.some((b) => /спонсорство/.test(b)), r.blockers.join("|"));
    assert.equal(r.pInterview, 0);
    assert.equal(r.priority, 0);
  });

  test("hard blockers: country outside goal, required language, master's degree, seniority gap ≥2, stop-list", () => {
    const cases: [string, Partial<JobCtx>, Partial<CandidateCtx["goal"]>?][] = [
      ["country", { countries: ["US"] }, { countries: ["KZ"] }],
      ["language", { languages: ["German"] }],
      ["education", { education: "Master's degree required" }],
      ["seniority", { seniority: "lead" }],
      ["stoplist", { company: "Evil Corp" }, { blockedCompanies: ["evil"] }],
    ];
    for (const [name, j, g] of cases) {
      const r = scoreJob(candidate({}, g ?? {}), job(j), NOW);
      assert.equal(r.eligibility, "blocked", `${name}: expected blocked, got ${r.eligibility} (${r.blockers.join("|")})`);
      assert.equal(r.pInterview, 0, name);
    }
  });

  test("soft gaps (missing skills, years, salary) never block", () => {
    const r = scoreJob(
      candidate({ skills: ["Excel"], yearsExperience: 1 }, { minSalary: 5000 }),
      job({ technologies: ["dbt", "Airflow", "Spark", "Looker"], minYears: 4, salaryMax: 3000 }),
      NOW,
    );
    assert.deepEqual(r.blockers, []);
    assert.ok(r.softGaps.length > 2);
    assert.equal(r.eligibility, "soft");
    assert.ok(r.pInterview > 0);
  });

  test("English below B1 is a hard blocker only when the job requires English", () => {
    const low = candidate({ englishLevel: "A2" });
    assert.equal(scoreJob(low, job({ languages: ["English"] }), NOW).eligibility, "blocked");
    assert.notEqual(scoreJob(low, job({ languages: [] }), NOW).eligibility, "blocked");
  });

  test("P(interview) stays within [0, 0.6] across extreme inputs", () => {
    const c = candidate({ allocation: { data_analyst: 50 } });
    for (const massHiring of [true, false]) for (const age of [0, 2, 10, 90]) {
      const r = scoreJob(c, job({ massHiring, postedAt: daysAgo(age) }), NOW);
      assert.ok(r.pInterview >= 0 && r.pInterview <= 0.6, `pInterview ${r.pInterview}`);
    }
  });

  test("fresher postings rank strictly higher, all else equal", () => {
    const ages = [0.2, 2, 5, 10, 20, 60];
    const p = ages.map((a) => scoreJob(candidate(), job({ postedAt: daysAgo(a) }), NOW).pInterview);
    for (let i = 1; i < p.length; i++) assert.ok(p[i - 1] > p[i], `age ${ages[i - 1]}d (${p[i - 1]}) should beat ${ages[i]}d (${p[i]})`);
  });

  test("future postedAt clamps freshness to 0", () => {
    assert.equal(scoreJob(candidate(), job({ postedAt: new Date(NOW.getTime() + 86400000) }), NOW).freshnessDays, 0);
  });
});

describe("readiness.assessReadiness", () => {
  const base = (over: Partial<ReadinessInput["goal"]> = {}, years = 3): ReadinessInput => ({
    profile: { yearsExperience: years, skills: ["SQL", "Python", "Excel", "Tableau", "Statistics"], englishLevel: "B2", cvText: "x".repeat(1000), summary: "Analyst", workAuth: ["KZ"], needsSponsorship: false, linkedin: "li", github: "gh", portfolio: "" },
    facts: [{ kind: "employment", metrics: "+20%", verified: true }, { kind: "employment", metrics: "30%", verified: true }],
    stories: 3,
    goal: { primaryRole: "Data Analyst", seniority: "middle", minSalary: 0, countries: ["KZ"], workModes: ["remote"], dreamCompanies: [], sponsorshipNeeded: false, ...over },
  });

  test("senior/lead goal with 1 year of experience is unrealistic with very low probability", () => {
    const r = assessReadiness(base({ seniority: "lead" }, 1));
    assert.equal(r.verdict, "unrealistic");
    assert.equal(r.probability, "very_low");
    assert.equal(r.suggestedSeniority, "junior");
    assert.ok(r.suggestions.some((s) => s.includes("lead")));
  });

  test("matching goal is not unrealistic and score is 0..100", () => {
    const r = assessReadiness(base());
    assert.notEqual(r.verdict, "unrealistic");
    assert.ok(r.score >= 0 && r.score <= 100);
    for (const c of r.checks) assert.ok(c.score >= 0 && c.score <= 100, `${c.key}=${c.score}`);
  });

  test("empty profile does not throw", () => {
    const r = assessReadiness({
      profile: { yearsExperience: 0, skills: [], englishLevel: "", cvText: "", summary: "", workAuth: [], needsSponsorship: false, linkedin: "", github: "", portfolio: "" },
      facts: [], stories: 0,
      goal: { primaryRole: "", seniority: "", minSalary: 0, countries: [], workModes: [], dreamCompanies: [], sponsorshipNeeded: false },
    });
    assert.ok(Number.isFinite(r.score));
  });
});

describe("inbox.classifyEmail", () => {
  const cases: [string, string, string, string][] = [
    ["confirmation", "Application received", "Thank you for applying to Kaspi. We have received your application and will review it.", "confirmation"],
    ["rejection", "Your application", "Unfortunately, we have decided to move forward with other candidates.", "rejection"],
    ["thanks+unfortunately", "Thank you for applying", "Thank you for applying to the Data Analyst role. Unfortunately, we will not be moving forward.", "rejection"],
    ["assessment", "Next step: coding challenge", "Please complete the HackerRank assessment within 3 days.", "assessment"],
    ["interview", "Interview invitation", "We would like to invite you to an interview. Please schedule a call via calendly.com/acme.", "interview"],
    ["offer", "Offer letter", "We are pleased to extend an offer. Your offer letter is attached.", "offer"],
    ["ru rejection", "Ваш отклик", "Спасибо за отклик. К сожалению, мы не готовы сделать предложение.", "rejection"],
  ];
  for (const [name, subj, body, want] of cases)
    test(`${name} → ${want}`, () => {
      const r = classifyEmail(subj, body);
      assert.equal(r.cls, want);
      assert.ok(r.confidence > 0 && r.confidence <= 0.99);
    });

  test("rejection overrides confirmation even when confirmation phrases outweigh a single 'unfortunately'", () => {
    const r = classifyEmail(
      "Application received",
      "Thank you for your application. We have received your application for the Data Analyst role. Unfortunately, the role was closed.",
    );
    assert.equal(r.cls, "rejection");
  });

  test("interview email carries a round; technical round detected", () => {
    const r = classifyEmail("Technical interview", "We'd like to invite you to an interview: a live coding session with the team.");
    assert.equal(r.cls, "interview");
    assert.equal(r.round, "technical");
  });

  test("empty email is unknown with low confidence", () => {
    const r = classifyEmail("", "");
    assert.equal(r.cls, "unknown");
    assert.ok(r.confidence < 0.5);
  });
});

describe("interview.detectIntent / scaffold", () => {
  test("intents", () => {
    assert.equal(detectIntent("Tell me about yourself"), "intro");
    assert.equal(detectIntent("What are your salary expectations?"), "salary");
    assert.equal(detectIntent("Tell me about a time you missed a deadline"), "behavioral");
    assert.equal(detectIntent("Why do you want to work at our company?"), "motivation");
    assert.equal(detectIntent("What is the difference between LEFT JOIN and INNER JOIN?"), "technical");
    assert.equal(detectIntent("Do you have any questions for us?"), "closing");
    assert.equal(detectIntent("What is your biggest weakness?"), "weakness");
  });

  const stories: StoryLite[] = [
    { id: "s1", title: "Cut report time", situation: "Manual Excel reports took 2 days", task: "Automate", action: "Built SQL + Python pipeline", result: "Reports in 1 hour", metric: "-90% time", tags: ["data", "initiative"] },
    { id: "s2", title: "Disagreed with PM", situation: "PM wanted launch without test", task: "Convince", action: "Ran A/B test", result: "Avoided -5% conversion", metric: "5%", tags: ["conflict", "impact"] },
  ];
  const facts: IvFact[] = [{ kind: "employment", title: "Data Analyst", org: "Kaspi", details: "Built dashboards\nOwned churn analysis", metrics: "+12% retention", tech: ["SQL"], teamSize: 5 }];
  const ctx = { stories, facts, skills: ["SQL", "Python", "Tableau"], yearsExperience: 3, company: "Acme", role: "Data Analyst", salary: { low: 30000, high: 42000 } };

  const questions = [
    "Tell me about yourself", "What are your salary expectations?", "Tell me about a time you disagreed with your manager",
    "Why do you want to join us?", "What is your biggest weakness?", "How would you estimate the market size?",
    "Explain the difference between a clustered and non-clustered index", "Any questions for us?", "Describe your role at Kaspi",
    "Tell me about a time you led a team under pressure", "", "?".repeat(2000),
  ];

  test("scaffold returns 1–5 bullets and a strategy for every intent", () => {
    for (const q of questions) {
      const s = scaffold(q, ctx);
      assert.ok(s.bullets.length >= 1 && s.bullets.length <= 5, `${JSON.stringify(q.slice(0, 40))}: ${s.bullets.length} bullets`);
      assert.ok(s.strategy.length > 0);
    }
    assert.equal(scaffold("Tell me about a time you disagreed with your PM", ctx).storyId, "s2");
  });

  test("scaffold works with no stories and no facts", () => {
    for (const q of questions) {
      const s = scaffold(q, { ...ctx, stories: [], facts: [] });
      assert.ok(s.bullets.length >= 1 && s.bullets.length <= 5);
    }
  });

  test("scaffold p99 latency < 5 ms", () => {
    for (let i = 0; i < 50; i++) scaffold(questions[i % questions.length], ctx); // warm-up
    const t: number[] = [];
    for (let i = 0; i < 2000; i++) {
      const a = performance.now();
      scaffold(questions[i % questions.length], ctx);
      t.push(performance.now() - a);
    }
    t.sort((a, b) => a - b);
    const p99 = t[Math.floor(t.length * 0.99)];
    assert.ok(p99 < 5, `p99 ${p99.toFixed(3)} ms`);
  });
});

describe("offer.benchmarkOffer / negotiationPlan", () => {
  const range = marketRange("data_analyst", "middle", ["WORLD"]);
  const levels = ["soft", "balanced", "assertive"] as const;

  test("below-mid offer recommends negotiating; gap is non-negative", () => {
    const b = benchmarkOffer({ base: range.low, roleFamily: "data_analyst", seniority: "middle", regions: ["WORLD"] });
    assert.equal(b.recommend, true);
    assert.ok(b.percentile < 50);
    assert.ok(b.gap > 0);
    const hi = benchmarkOffer({ base: range.high * 2, roleFamily: "data_analyst", seniority: "middle", regions: ["WORLD"] });
    assert.equal(hi.recommend, false);
    assert.equal(hi.gap, 0);
  });

  test("ask ≥ target ≥ base and walkaway ∈ [base, target] for all levels and bases (incl. above market)", () => {
    for (const level of levels) for (const base of [1000, range.low, range.mid, range.high, range.high * 3]) {
      const p = negotiationPlan({ company: "Acme", role: "Data Analyst", base, currency: "USD", range, strengths: ["+12% retention"], name: "A", level });
      assert.ok(p.ask >= base, `${level}/${base}: ask ${p.ask} < base`);
      assert.ok(p.ask >= p.target, `${level}/${base}: ask ${p.ask} < target ${p.target}`);
      assert.ok(p.walkaway <= p.target, `${level}/${base}: walkaway ${p.walkaway} > target ${p.target}`);
      assert.ok(p.walkaway >= Math.round(base / 1000) * 1000 - 500, `${level}/${base}: walkaway ${p.walkaway} below base`);
    }
  });

  test("more assertive → higher target", () => {
    const t = levels.map((level) => negotiationPlan({ company: "A", role: "R", base: range.low, currency: "USD", range, strengths: [], name: "A", level }).target);
    assert.ok(t[0] <= t[1] && t[1] <= t[2], t.join(","));
  });
});

describe("market.percentileIn", () => {
  test("monotonic non-decreasing and bounded 1..99", () => {
    const r = marketRange("software_engineer", "senior", ["EU"]);
    let prev = 0;
    for (let v = 0; v <= r.high * 3; v += 500) {
      const p = percentileIn(v, r);
      assert.ok(p >= prev, `percentile dropped at ${v}: ${prev} → ${p}`);
      assert.ok(p >= 1 && p <= 99);
      prev = p;
    }
    assert.equal(percentileIn(r.mid, r), 50);
  });

  test("degenerate range (low=mid=high) does not produce NaN", () => {
    const p = percentileIn(1000, { low: 5000, mid: 5000, high: 5000 });
    assert.ok(Number.isFinite(p));
  });
});

describe("profile.parseCVHeuristic", () => {
  const CV = `Aruzhan Sadykova
Data Analyst
Almaty, Kazakhstan · aruzhan@example.com · +7 700 123 45 67 · linkedin.com/in/aruzhan · github.com/aruzhan
English: B2

Experience
Data Analyst at Kaspi.kz  Jan 2023 – Present
- Built Tableau dashboards used by 40 managers
- Reduced report preparation time by 60% with SQL and Python
Junior Analyst at Halyk Bank  Mar 2021 – Dec 2022
- Excel models for credit risk

Education
Bachelor of Economics, KBTU  2017 – 2021

Skills
SQL, Python, Tableau, Excel, Statistics
Certification: Google Data Analytics`;

  test("extracts identity, experience, facts and skills", () => {
    const r = parseCVHeuristic(CV);
    assert.equal(r.name, "Aruzhan Sadykova");
    assert.equal(r.headline, "Data Analyst");
    assert.equal(r.email, "aruzhan@example.com");
    assert.equal(r.location, "Almaty");
    assert.equal(r.englishLevel, "B2");
    assert.match(r.linkedin, /linkedin\.com\/in\/aruzhan/);
    const jobs = r.facts.filter((f) => f.kind === "employment");
    assert.equal(jobs.length, 2, JSON.stringify(r.facts.map((f) => [f.kind, f.title])));
    assert.equal(jobs[0].org, "Kaspi.kz");
    assert.match(jobs[0].metrics, /60%/);
    assert.equal(r.facts.filter((f) => f.kind === "education").length, 1);
    assert.ok(r.facts.some((f) => f.kind === "certification"));
    for (const s of ["SQL", "Python", "Tableau", "Excel"]) assert.ok(r.skills.includes(s), s);
    // Mar 2021 → today (2026-09): ≥ 5 years; education excluded
    assert.ok(r.yearsExperience >= 5 && r.yearsExperience < 7, `years ${r.yearsExperience}`);
  });

  test("empty / garbage input does not throw", () => {
    for (const t of ["", "\n\n\n", "%%%%", "a".repeat(50000)]) {
      const r = parseCVHeuristic(t);
      assert.equal(r.yearsExperience >= 0, true);
    }
  });
});

describe("personalize.buildPackageHeuristic", () => {
  const profile: ProfileLite = {
    name: "Aruzhan", email: "a@x.kz", phone: "", location: "Almaty", headline: "Data Analyst", summary: "", skills: ["SQL", "Python", "Excel", "Tableau"],
    yearsExperience: 3, englishLevel: "B2", workAuth: ["KZ"], needsSponsorship: false, relocation: false, linkedin: "", github: "", portfolio: "",
    noticePeriod: "2 weeks", salaryExpectation: 2000, citizenship: "KZ",
  };
  const facts: FactLite[] = [
    { id: "f1", kind: "employment", title: "Data Analyst", org: "Kaspi", startDate: "2023", endDate: "Present", details: "Built dashboards in Tableau\nSQL churn model", metrics: "+12% retention", tech: ["SQL", "Tableau"], verified: true },
  ];
  const jobL: JobLite = { title: "Senior Data Analyst", company: "Acme", roleFamily: "data_analyst", description: "We need SQL, dbt, Looker, Airflow and Spark", technologies: ["SQL", "dbt", "Looker"], requirements: ["Spark"], countries: ["KZ"], remote: "remote", sponsorship: "unknown", salaryMin: null, salaryMax: null, industry: "" };

  test("never invents skills: skillsOrder is a permutation of profile skills; job-relevant skills first", () => {
    const pkg = buildPackageHeuristic(profile, facts, jobL);
    assert.deepEqual([...pkg.skillsOrder].sort(), [...profile.skills].sort());
    assert.equal(pkg.skillsOrder[0], "SQL");
    for (const bogus of ["dbt", "Looker", "Airflow", "Spark"]) {
      assert.ok(!pkg.skillsOrder.includes(bogus), `invented skill ${bogus}`);
      assert.ok(!pkg.summary.includes(bogus), `summary mentions ${bogus}`);
    }
    assert.ok(pkg.cvText.includes("Aruzhan"));
    assert.ok(pkg.coverLetter.length > 0);
  });

  test("empty profile and facts do not throw", () => {
    const pkg = buildPackageHeuristic({ ...profile, skills: [], yearsExperience: 0 }, [], jobL);
    assert.deepEqual(pkg.skillsOrder, []);
  });
});

describe("insights.segmentStats", () => {
  const opp = (segment: string, status: string, interview: boolean, submitted = true): OppLite => ({
    status, segment, lane: "standard", submittedAt: submitted ? daysAgo(5) : null, match: 70,
    job: { remote: "remote", countries: "KZ", postedAt: daysAgo(7), seniority: "middle" }, reachedInterview: interview, reachedAssessment: false,
  });

  test("counts only submitted, smooths rates, sorts by smoothed desc, verdicts", () => {
    const opps = [
      ...Array.from({ length: 10 }, (_, i) => opp("data_analyst", i < 4 ? "recruiter" : "rejected", i < 4)),
      ...Array.from({ length: 16 }, () => opp("support", "rejected", false)),
      opp("qa", "prepared", false, false), // not submitted → ignored
    ];
    const s = segmentStats(opps, (o) => o.segment);
    assert.deepEqual(s.map((x) => x.key), ["data_analyst", "support"]);
    const [da, sup] = s;
    assert.equal(da.applied, 10);
    assert.equal(da.interviews, 4);
    assert.equal(da.rate, 0.4);
    assert.ok(da.smoothed < da.rate && da.smoothed > 0.1);
    assert.equal(sup.verdict, "stop");
    assert.equal(da.verdict, "scale");
    for (const x of s) assert.ok(x.weight >= 0.25 && x.weight <= 2.2);
  });

  test("empty input → []", () => {
    assert.deepEqual(segmentStats([], (o) => o.segment), []);
  });
});
