// Demo vacancy corpus (fictional companies). Marked source="demo" everywhere in the UI.
type Seed = { company: string; title: string; location: string; description: string; ageHours: number; remoteHint?: boolean; industry: string };

const COMPANIES = [
  ["Northwind Pay", "Fintech"], ["Kestrel Analytics", "SaaS"], ["Lumen Bank", "Fintech"], ["Orbital Commerce", "E-commerce"], ["Tallgrass Health", "Healthtech"],
  ["Quanta Freight", "Logistics"], ["Brightwave Learning", "Edtech"], ["Helix Games", "Gaming"], ["Mosaic Travel", "Travel"], ["Arcadia Cloud", "SaaS"],
  ["Silkroad Markets", "Fintech"], ["Pinecone Mobility", "Mobility"], ["Vantage Media", "Media"], ["Cobalt Security", "Cybersecurity"], ["Steppe Digital", "SaaS"],
] as const;

const ROLES: { title: string; stack: string[]; years: number; extra?: string }[] = [
  { title: "Data Analyst", stack: ["SQL", "Python", "Tableau", "Excel"], years: 2 },
  { title: "Junior Data Analyst", stack: ["SQL", "Excel", "Power BI"], years: 0 },
  { title: "Product Analyst", stack: ["SQL", "Python", "A/B testing", "Amplitude"], years: 2 },
  { title: "Senior Data Analyst", stack: ["SQL", "Python", "Looker", "dbt"], years: 5 },
  { title: "BI Analyst", stack: ["SQL", "Power BI", "Excel"], years: 1 },
  { title: "Data Scientist", stack: ["Python", "SQL", "Machine Learning", "Statistics"], years: 3 },
  { title: "Analytics Engineer", stack: ["SQL", "dbt", "BigQuery", "Python"], years: 2 },
  { title: "Growth Analyst", stack: ["SQL", "Google Analytics", "A/B testing"], years: 1 },
  { title: "Frontend Engineer", stack: ["TypeScript", "React", "Next.js"], years: 3 },
  { title: "Backend Engineer", stack: ["Go", "PostgreSQL", "Docker", "Kubernetes"], years: 3 },
  { title: "QA Engineer", stack: ["Manual testing", "Postman", "SQL"], years: 1 },
  { title: "Customer Support Specialist", stack: ["Zendesk", "Intercom"], years: 0, extra: "We are hiring multiple agents for our growing support team. No prior experience required; training provided. Short online assessment after applying." },
  { title: "Sales Development Representative", stack: ["CRM", "HubSpot", "Cold outreach"], years: 0, extra: "Hiring multiple SDRs for our international cohort. Online assessment + one interview." },
  { title: "Operations Associate", stack: ["Excel", "Notion"], years: 0, extra: "High-volume hiring for our operations team. Assessment-based process." },
  { title: "AI Data Annotator (English)", stack: [], years: 0, extra: "Remote, flexible hours. Hiring several positions. Qualification test required." },
  { title: "Graduate Program — Analytics", stack: ["SQL", "Excel"], years: 0, extra: "Our 12-month graduate program rotates through analytics teams. Online assessment, then a final interview day." },
  { title: "Product Manager", stack: ["Roadmapping", "SQL", "User research"], years: 4 },
  { title: "Marketing Analyst", stack: ["SQL", "Google Analytics", "Excel", "Tableau"], years: 2 },
];

const LOCATIONS: { loc: string; remote?: boolean; note: string }[] = [
  { loc: "Remote — Europe", remote: true, note: "Fully remote within European time zones (UTC-1 to UTC+5)." },
  { loc: "Remote — Worldwide", remote: true, note: "Work from anywhere. We hire globally as contractors." },
  { loc: "Almaty, Kazakhstan (Hybrid)", note: "Hybrid: 2 days per week in our Almaty office." },
  { loc: "Berlin, Germany", note: "On-site in Berlin. We offer visa sponsorship and relocation support." },
  { loc: "London, United Kingdom", note: "Hybrid in London. Candidates must be authorized to work in the United Kingdom. We are unable to sponsor visas." },
  { loc: "New York, United States", note: "Onsite in New York. Must be authorized to work in the United States without sponsorship." },
  { loc: "Remote — US", remote: true, note: "Remote within the US only. Must be authorized to work in the United States." },
  { loc: "Warsaw, Poland (Hybrid)", note: "Hybrid in Warsaw. Visa sponsorship available for the right candidate." },
  { loc: "Dubai, UAE", note: "On-site in Dubai. Relocation package and visa provided." },
  { loc: "Astana, Kazakhstan", note: "Office-based in Astana. Russian and English required." },
];

function rng(seed: number) {
  let x = seed;
  return () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648);
}

export const SEED_JOBS: Seed[] = (() => {
  const r = rng(42);
  const out: Seed[] = [];
  for (let i = 0; i < 280; i++) {
    const [company, industry] = COMPANIES[Math.floor(r() * COMPANIES.length)];
    const role = ROLES[i % ROLES.length];
    const L = LOCATIONS[r() < 0.45 ? Math.floor(r() * 2) : Math.floor(r() * LOCATIONS.length)];
    const mid = role.years >= 5 ? 110 : role.years >= 3 ? 85 : role.years >= 1 ? 62 : 38;
    const geo = L.loc.includes("US") || L.loc.includes("New York") ? 1.35 : L.loc.includes("London") ? 1.05 : L.loc.includes("Kazakhstan") ? 0.4 : L.loc.includes("Worldwide") ? 0.8 : 0.9;
    const lo = Math.round((mid * geo * (0.9 + r() * 0.15)) / 1) * 1000;
    const hi = Math.round(lo * 1.25 / 1000) * 1000;
    const showSalary = r() > 0.35;
    const reqs = [
      role.years ? `${role.years}+ years of experience in a similar role` : "No prior experience required — strong learning ability",
      ...role.stack.map((t) => `Hands-on experience with ${t}`),
      "Strong communication skills in English (B2+)",
      role.title.includes("Data") || role.title.includes("Analyst") ? "Ability to turn data into clear business recommendations" : "Ownership and attention to detail",
    ];
    const description = [
      `${company} (${industry}) is hiring a ${role.title}.`,
      role.extra ?? `You'll join a cross-functional team and own ${role.title.includes("Analyst") ? "dashboards, experiments and insights that drive product decisions" : "meaningful parts of our product"}.`,
      "Requirements:",
      ...reqs.map((q) => `- ${q}`),
      `Tech: ${role.stack.join(", ") || "Google Workspace"}.`,
      L.note,
      showSalary ? `Salary range: $${lo.toLocaleString("en-US")} - $${hi.toLocaleString("en-US")} per year.` : "",
    ].filter(Boolean).join("\n");
    const ageHours = Math.round(Math.pow(r(), 2.2) * 24 * 50) + 1; // skewed fresh; some stale (up to ~50 days)
    out.push({ company, title: role.title, location: L.loc, description, ageHours, remoteHint: L.remote, industry });
  }
  return out;
})();
