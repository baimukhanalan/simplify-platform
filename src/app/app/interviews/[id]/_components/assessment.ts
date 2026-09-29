// Online assessment: test format, topics, preparation plan and practice questions (pure). Returns message keys and
// params; assessment-tab.tsx renders them in the interface language («interviewPractice.assessment.*»).

/** Topic label keys: «interviewPractice.assessment.topic.<labelKey>» / «….short.<labelKey>». */
export type TopicKey = "sql" | "python" | "excel" | "stats" | "viz" | "analytics" | "analyticsCase" | "logic";
export type AssessmentTopic = { key: string; labelKey: TopicKey; weight: number; have: boolean };
/** A practice task: «interviewPractice.assessment.practice.<id>.q/.a», topic «….practiceTopic.<topic>». */
export type PracticeQ = { id: PracticeId; topic: PracticeTopic };
export type PracticeTopic = "sql" | "analytics" | "logic" | "numbers" | "excel" | "python" | "stats" | "viz";
export type PracticeId = "sql1" | "sql2" | "sql3" | "analytics1" | "analytics2" | "logic1" | "logic2" | "logic3" | "excel1" | "excel2" | "python1" | "python2" | "stats1" | "stats2" | "viz1";

const PLATFORMS = ["TestGorilla", "HackerRank", "Codility", "CodeSignal", "SHL", "Pymetrics", "Criteria", "Maki", "Mettl", "Alooba", "Glider"];

const TOPIC_OF: [RegExp, TopicKey][] = [
  [/sql|postgres|mysql|bigquery|clickhouse|snowflake/i, "sql"],
  [/python|pandas|numpy|\br\b/i, "python"],
  [/excel|google sheets|spreadsheet/i, "excel"],
  [/a\/b|experiment|statistic/i, "stats"],
  [/tableau|power bi|looker|metabase|visuali/i, "viz"],
  [/google analytics|amplitude|mixpanel/i, "analytics"],
];

/** Sample dates in the practice tasks use the current year, never a stale one (params {year} / {next}). */
export const PRACTICE_YEAR = new Date().getFullYear();

const q = (id: PracticeId, topic: PracticeTopic): PracticeQ => ({ id, topic });
export const PRACTICE: Record<string, PracticeQ[]> = {
  sql: [q("sql1", "sql"), q("sql2", "sql"), q("sql3", "sql")],
  analytics: [q("analytics1", "analytics"), q("analytics2", "analytics")],
  logic: [q("logic1", "logic"), q("logic2", "logic"), q("logic3", "numbers")],
  excel: [q("excel1", "excel"), q("excel2", "excel")],
  python: [q("python1", "python"), q("python2", "python")],
  stats: [q("stats1", "stats"), q("stats2", "stats")],
  viz: [q("viz1", "viz")],
};

/** What to drill first for the main topic of the test: «….drill.<key>». */
export type DrillKey = "sql" | "python" | "excel" | "stats" | "viz" | "analytics" | "default";
const DRILL = new Set<string>(["sql", "python", "excel", "stats", "viz", "analytics"]);

export type PlanWhen = "now30" | "then20" | "hourBefore" | "day1" | "day2";
export type PlanStep =
  | { when: PlanWhen; what: "cheatSheet" | "drill" | "gap"; topic: TopicKey | "keySkill"; drill?: DrillKey }
  | { when: PlanWhen; what: "timed" | "setup" | "cases" | "logic" | "rules" }
  | { when: PlanWhen; what: "rehearsal"; min: number };

export type AssessmentInfo = {
  platform: string | null;
  durationMin: number;
  deadline: Date | null;
  hoursLeft: number | null;
  topics: AssessmentTopic[];
  difficulty: { level: 1 | 2 | 3; senior: boolean; gaps: number; massHiring: boolean };
  plan: PlanStep[];
  practice: PracticeQ[];
};

export function assessmentInfo(i: { technologies: string[]; skills: string[]; seniority: string; massHiring: boolean; emails: string[]; deadline: Date | null; now: number; roleFamily: string }): AssessmentInfo {
  const mail = i.emails.join("\n");
  const platform = PLATFORMS.find((p) => new RegExp(p, "i").test(mail)) ?? null;
  const dur = Number(mail.match(/(\d{2,3})\s*(?:-|\s)?(?:minute|min|минут)/i)?.[1]);
  const durationMin = dur >= 10 && dur <= 240 ? dur : 60;
  const have = new Set(i.skills.map((s) => s.toLowerCase()));

  const topics = new Map<string, AssessmentTopic>();
  for (const t of i.technologies) {
    const hit = TOPIC_OF.find(([re]) => re.test(t));
    if (hit && !topics.has(hit[1])) topics.set(hit[1], { key: hit[1], labelKey: hit[1], weight: 0, have: have.has(t.toLowerCase()) });
  }
  if (/analyst|data|product/.test(i.roleFamily) && !topics.has("analytics")) topics.set("analytics", { key: "analytics", labelKey: "analyticsCase", weight: 0, have: true });
  const main = [...topics.values()].slice(0, 4);
  const list: AssessmentTopic[] = [...main, { key: "logic", labelKey: "logic", weight: 0, have: true }];
  list.forEach((t) => (t.weight = t.key === "logic" ? (main.length ? 20 : 100) : Math.round(80 / Math.max(1, main.length))));

  const gaps = list.filter((t) => !t.have).length;
  const senior = ["middle", "senior", "lead"].includes(i.seniority);
  const score = (senior ? 2 : 1) + (gaps ? 1 : 0) + (i.massHiring ? -1 : 0);
  const level = (Math.max(1, Math.min(3, score)) as 1 | 2 | 3);
  const difficulty = { level, senior, gaps, massHiring: i.massHiring };

  const hoursLeft = i.deadline ? Math.round((i.deadline.getTime() - i.now) / 3600000) : null;
  const first = main[0]?.labelKey ?? "keySkill";
  const drill: DrillKey = main[0] && DRILL.has(main[0].key) ? (main[0].key as DrillKey) : "default";
  const weak = list.find((t) => !t.have)?.labelKey;
  const plan: PlanStep[] =
    hoursLeft != null && hoursLeft <= 24
      ? [
          { when: "now30", what: "cheatSheet", topic: first },
          { when: "then20", what: "timed" },
          { when: "hourBefore", what: "setup" },
        ]
      : [
          { when: "day1", what: "drill", topic: first, drill },
          weak ? { when: "day1", what: "gap", topic: weak } : { when: "day1", what: "cases" },
          { when: "day2", what: "logic" },
          { when: "day2", what: "rehearsal", min: durationMin },
          { when: "hourBefore", what: "rules" },
        ];

  const practice = [...main.flatMap((t) => (PRACTICE[t.key] ?? []).slice(0, 2)).slice(0, 6), ...PRACTICE.logic.slice(0, 2)];
  return { platform, durationMin, deadline: i.deadline, hoursLeft, topics: list, difficulty, plan, practice };
}
