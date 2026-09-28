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

Demo account: `demo@simplify.kz` / `simplify2026` (active International campaign). Locally the seed also
creates `admin@simplify.kz` (/admin) and `partner@amaskills.kz` (/partners) with the same password; against
Postgres the seed requires `ALLOW_DEMO_SEED=1` and `ADMIN_PASSWORD` for those staff accounts.

## Environment

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | SQLite locally (`file:./dev.db`). For production switch the Prisma provider to `postgresql`. |
| `SESSION_SECRET` | ≥32 random bytes, signs session JWTs. |
| `ANTHROPIC_API_KEY` | Optional. Enables Claude for CV parsing, packages, interview packs. Without it the deterministic engine runs everything. |
| `SIMPLIFY_MODEL` | Claude model id, default `claude-opus-5`. |
| `SIMPLIFY_GREENHOUSE_BOARDS` / `SIMPLIFY_LEVER_COMPANIES` | Comma-separated public boards for live job ingestion. |
| `CRON_SECRET` | Protects `GET /api/cron/tick` (one agent cycle for every active campaign). |
| `SEED_TOKEN` | Optional, ≥32 chars. Enables `POST /api/admin/seed-demo` (Bearer). Unset = endpoint returns 404. |
| `KASPI_MODE` | `mock` enables the built-in Kaspi Pay mock gateway (pay buttons on `/pay/kaspi/[id]`, `POST /api/payments/kaspi/mock/[id]/pay`). Default `mock` in development; **in production it must be set explicitly**, anything else = real flow (mock endpoints 404). |
| `KASPI_MOCK_SECRET` | ≥32 chars, signs mock-gateway webhooks. Must differ from `KASPI_WEBHOOK_SECRET`. If unset in production, a dedicated key is derived from `SESSION_SECRET`. Mock-signed events are accepted only while `KASPI_MODE=mock`. |
| `KASPI_WEBHOOK_SECRET` | ≥32 chars, real Kaspi Pay webhook key. Unset in production = real events are rejected. |
| `APP_URL` | Public base URL (e.g. `https://simplify.example`). Used for the mock gateway's server-to-server webhook call; falls back to `VERCEL_PROJECT_PRODUCTION_URL`, and to the request origin only in development (the Host header is never trusted in production). |

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
- **Payments**: Kaspi Pay flow in `src/lib/payments/kaspi.ts` — invoice → payment → signed webhook → campaign.
  The public demo runs the **mock gateway** (`KASPI_MODE=mock`, no money moves; max 3 mock-paid campaigns per
  user per 24 h). Webhook contract: `X-Kaspi-Timestamp` (unix s, ±5 min) and `X-Kaspi-Signature: sha256=<hex>`
  = HMAC-SHA256 of `"<timestamp>.<raw body>"`; replays are deduplicated on `transactionId`. Paying while a
  campaign is running is refused (409); a payment that still arrives (late, duplicate, second invoice) is marked
  `refund_due` in the payment's meta instead of being attached. Claim + campaign creation run in one transaction;
  the first agent cycle runs after the webhook response (`after()`). Partner attribution comes only from the
  account's `referredByCode`.
- **Inbox**: paste or simulate; Gmail/Outlook OAuth is a planned integration.
- **Salary data** are model estimates (`market.ts`), labeled as such.
- **Copilot** uses the browser's speech recognition; Simplify stores no audio. It is disabled for
  interviews where the employer forbids external help.
