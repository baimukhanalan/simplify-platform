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
| `HH_CLIENT_ID` / `HH_CLIENT_SECRET` | hh.kz API app credentials (dev.hh.ru). **Both unset = the hh integration is off**: no hh search, the Agent screen shows «Скоро», hh vacancies are handoffs. |
| `HH_REDIRECT_URI` | OAuth redirect URI; default `${APP_URL}/api/integrations/hh/callback`. Must match the value registered at dev.hh.ru exactly. |
| `HH_USER_AGENT` | Sent as `HH-User-Agent` (and `User-Agent`) on every hh request; default `Simplify/1.0 (support@simplify.kz)`. hh requires a real app name + contact. |
| `HH_APP_TOKEN` | Optional. The application token (client_credentials) issued once; recommended on serverless so cold starts don't re-issue it (hh rate-limits issuing and a new one can invalidate the old). Unset = issued on demand and cached in memory. |
| `ENCRYPTION_KEY` | Optional, 32 bytes (hex/base64): AES-256-GCM key for third-party tokens at rest (hh). Default: derived from `SESSION_SECRET`. |
| `SIMPLIFY_EXTENSION_IDS` | Optional, comma-separated Chrome extension ids allowed to call `/api/extension/*` (CORS). Unset = any `chrome-extension://` origin; the `X-Simplify-Token` key is the credential either way. |

## Architecture

| Layer | Where |
|---|---|
| Identity & profile, Truth Layer | `prisma/schema.prisma` (User, Profile, Fact, Story, MiniInterviewAnswer), `src/lib/engine/profile.ts` |
| Job ingestion (Remotive, Arbeitnow, Greenhouse, Lever + demo corpus), normalization, dedupe, freshness | `src/lib/engine/ingest.ts` |
| Matching: Match vs Eligibility (hard blockers), P(Interview) ranking | `src/lib/engine/matching.ts` |
| Readiness | `src/lib/engine/readiness.ts` |
| Personalization + Truth Check + screening-answer policy (auto / rule / approval) | `src/lib/engine/personalize.ts` |
| Orchestration: discover → rerank → prepare → submit / handoff, inbox → pipeline | `src/lib/engine/agent.ts` |
| hh.kz: API client (app + user OAuth tokens, search, vacancy, resumes, negotiations), apply adapter, status sync, OAuth routes | `src/lib/hh/*`, `src/lib/sources/hh.ts`, `src/app/api/integrations/hh/*` |
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
- **hh.kz**: the user connects **their own** hh account (OAuth on hh.kz; Simplify never sees the password) and
  picks one of their resumes on `/app/agent`. The agent then applies through `POST /negotiations` as the user, with that
  resume and the package's cover letter — only inside the same consent / autonomy / daily-limit gates as any other
  submission. Vacancies that require a test or questionnaire, an external application site, or a letter the package
  lacks become handoffs (Approvals → the hh vacancy link); answers are never invented. 429 → backoff; hh's daily
  negotiation limit pauses hh applications until the next day. Negotiation states (invitation / discard / …) are
  synced by the cron into the pipeline (forward only), inbox, notifications and Interview Rooms. Vacancy search uses
  the official API with an application token — no HTML scraping.
- **Inbox**: paste or simulate; Gmail/Outlook OAuth is a planned integration.
- **Salary data** are model estimates (`market.ts`), labeled as such.
- **Copilot** uses the browser's speech recognition; Simplify stores no audio. It is disabled for
  interviews where the employer forbids external help.

### hh.kz setup (owner)
1. Sign in at https://dev.hh.ru with an hh account owned by the company and create an application
   («Добавить приложение»). Name/description: Simplify — AI career agent; contact e-mail = the one in `HH_USER_AGENT`.
2. Redirect URI: `https://<your domain>/api/integrations/hh/callback` (exactly, https, no trailing slash). For local
   testing register a separate dev application with `http://localhost:3210/api/integrations/hh/callback` and use its
   credentials locally (set `HH_REDIRECT_URI` to the same value).
3. Wait for hh's moderation; copy Client ID and Client Secret into `HH_CLIENT_ID` / `HH_CLIENT_SECRET` (Vercel →
   Environment Variables, Production + Preview), set `APP_URL` (or `HH_REDIRECT_URI`) and `HH_USER_AGENT`
   (`Simplify/1.0 (<support e-mail>)`).
4. Optional but recommended on Vercel: issue the application token once
   (`curl -X POST https://api.hh.ru/token -H 'HH-User-Agent: <ua>' -d grant_type=client_credentials -d client_id=… -d client_secret=…`)
   and store it as `HH_APP_TOKEN`.
5. Redeploy. Check: `/app/agent` shows «hh.kz → Подключить», connect a test applicant account, pick a resume;
   `/admin` → live ingest shows an `hh` row; the daily cron reports `hh.synced`.

## Browser extension — Simplify Apply Assist

`extension/` is a Manifest V3 extension (plain JS, no build step) that pre-fills the **official** application form
(Greenhouse, Lever, Ashby, Workable, hh.kz response form, generic forms) from the user's own Simplify package: profile
contacts and links, the exact tailored CV (attached as a PDF), the cover letter, and screening answers that are filled
or approved. It fills only when the user clicks «Заполнить форму», highlights every field it touched, lists what needs
attention, and **never clicks Submit**. Sensitive / legal / EEO questions (gender, race, disability, veteran status,
criminal record, consents, background checks) are never filled — they are highlighted for the user. No personas,
stealth, captcha solving or proxies. Permissions: `activeTab`, `scripting`, `storage`, host access only for Simplify
and the supported ATS domains (no `<all_urls>`, no content scripts running on their own).

**Install (unpacked)**
1. Signed in, open `/app/extension` → «Скачать расширение (.zip)» (served by `GET /api/extension/download`, zipped on the
   fly from `extension/`), or use the `extension/` folder from this repo directly.
2. `chrome://extensions` → enable *Developer mode* → *Load unpacked* → select the unzipped `simplify-apply-assist`
   folder (or `extension/`).

**Pair**
1. On `/app/extension` click «Создать ключ для расширения». The key is shown once; only its sha256 is stored
   (`Integration` with `provider = "extension"`, `tokenHash`). A new key replaces the old one; «Отозвать ключ» deletes it.
2. Extension → *Options*: paste the key; the Simplify URL defaults to `https://simplify-platform-tau.vercel.app`
   (use `http://localhost:3210` for local dev). «Сохранить и проверить» calls `/api/extension/profile`.

**API** (all require `X-Simplify-Token`; CORS only for `chrome-extension://` origins; rate-limited per key):
`GET /api/extension/profile` · `GET /api/extension/match?url=` (Greenhouse job id / `gh_jid`, Lever and Ashby posting
ids, Workable shortcode, hh vacancy id, else host + path) · `GET /api/extension/cv/:opportunityId` (same PDF as
`/api/applications/[id]/cv`) · `POST /api/extension/mark-submitted {opportunityId}` — the user confirms they sent it;
recorded through `submit(id, "user")`, the handoff approval is closed and «Заявка отправлена через расширение» is logged.
Code: `src/app/api/extension/**`, `src/app/app/extension/`, `src/lib/actions/extension.ts`, tests in `tests/extension.test.ts`.
