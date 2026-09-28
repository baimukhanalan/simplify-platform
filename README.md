# Simplify — AI Career Agent platform

> Tell us what job you want. We handle the rest. **Stop applying. Start interviewing.**

Full-stack platform for the Simplify Career Campaign: one Career Profile → goal → autonomous
60-day campaign (discovery, match & eligibility, ranking, tailored packages, execution, tracking,
feedback loop) → Interview Room, Mock Interview, live Interview Copilot → Offer Desk → HIRED →
Passive Career Mode.

## Run locally

```bash
npm install
npx prisma db push      # creates prisma/dev.db (SQLite)
npm run seed            # demo scenario: Data Analyst from Almaty
npm run dev
```

Demo accounts (password `simplify2026`): `demo@simplify.kz` (active International campaign),
`admin@simplify.kz` (/admin), `partner@amaskills.kz` (/partners).

## Environment

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | SQLite locally (`file:./dev.db`). For production switch the Prisma provider to `postgresql`. |
| `SESSION_SECRET` | ≥32 random bytes, signs session JWTs. |
| `ANTHROPIC_API_KEY` | Optional. Enables Claude for CV parsing, packages, interview packs. Without it the deterministic engine runs everything. |
| `SIMPLIFY_MODEL` | Claude model id, default `claude-opus-5`. |
| `SIMPLIFY_GREENHOUSE_BOARDS` / `SIMPLIFY_LEVER_COMPANIES` | Comma-separated public boards for live job ingestion. |
| `CRON_SECRET` | Protects `GET /api/cron/tick` (one agent cycle for every active campaign). |

## Architecture

| Layer | Where |
|---|---|
| Identity & profile, Truth Layer | `prisma/schema.prisma` (User, Profile, Fact, Story, MiniInterviewAnswer), `src/lib/engine/profile.ts` |
| Job ingestion (Remotive, Arbeitnow, Greenhouse, Lever + demo corpus), normalization, dedupe, freshness | `src/lib/engine/ingest.ts` |
| Matching: Match vs Eligibility (hard blockers), P(Interview) ranking | `src/lib/engine/matching.ts` |
| Readiness | `src/lib/engine/readiness.ts` |
| Personalization + Truth Check + screening-answer policy (auto / rule / approval) | `src/lib/engine/personalize.ts` |
| Orchestration: discover → rerank → prepare → submit / handoff, inbox → pipeline | `src/lib/engine/agent.ts` |
| Inbox Intelligence | `src/lib/engine/inbox.ts` |
| Feedback loop / allocation | `src/lib/engine/insights.ts` |
| Interview: intent, retrieval, scaffold, truth guard, packs, mock scoring | `src/lib/engine/interview.ts` (pure, runs in browser), `interview-ai.ts` |
| Offer benchmark & negotiation, market ranges, Career Score | `offer.ts`, `market.ts`, `career.ts` |
| Claude wrapper with engine fallback | `src/lib/ai.ts` |

### Honest boundaries
- **Submission**: demo vacancies go through a simulated ATS adapter. Live vacancies are
  user-authorized handoffs — the package is prepared and the user submits via the official form
  (no credential storage, no ToS-violating automation). Official ATS integrations plug into `submit()`.
- **Payments** run in test mode (`provider: "test"`); Kaspi Pay / Stripe plug into `checkout()`.
- **Inbox**: paste or simulate; Gmail/Outlook OAuth is a planned integration.
- **Salary data** are model estimates (`market.ts`), labeled as such.
- **Copilot** uses the browser's speech recognition; Simplify stores no audio. It is disabled for
  interviews where the employer forbids external help.
