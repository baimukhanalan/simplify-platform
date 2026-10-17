<div align="center">

# Simplify

### Stop applying. Start interviewing. — your autonomous AI career agent

[![Next.js](https://img.shields.io/badge/Next.js-16-000000?style=for-the-badge&logo=next.js&logoColor=white)](https://nextjs.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB?style=for-the-badge&logo=react&logoColor=black)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Prisma](https://img.shields.io/badge/Prisma-6-2D3748?style=for-the-badge&logo=prisma&logoColor=white)](https://www.prisma.io/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-4-06B6D4?style=for-the-badge&logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)
[![Anthropic](https://img.shields.io/badge/Anthropic-Claude-D97757?style=for-the-badge&logo=anthropic&logoColor=white)](https://www.anthropic.com/)

[![Live Demo](https://img.shields.io/badge/Live_Demo-▶_simplify--career--landing-000000?style=for-the-badge)](https://simplify-career-landing.vercel.app)

</div>

---

## 📖 About

**Simplify** is an autonomous AI career agent. You build one **Career Profile**, set a goal, and the agent runs a **60-day job campaign** on your behalf: it discovers roles, matches and ranks them by your real odds of an interview, assembles tailored application packages, prepares you through an **Interview Room**, **Mock Interview** and a live **Interview Copilot**, and helps you close in the **Offer Desk**.

Everything is grounded in a **Truth Layer** — verified facts and STAR stories extracted from your CV and a short mini-interview — so the agent never invents experience. When an `ANTHROPIC_API_KEY` is present, Claude powers CV parsing, package generation and interview prep; without it, a deterministic engine runs the same flow end to end.

The platform ships with **seed/demo data** and dedicated **admin** and **partner** roles for operating and distributing the product.

## ✨ Features

- 🔎 **Discovery** — ingests and normalizes live roles from Remotive, Arbeitnow, Greenhouse and Lever (plus a demo corpus), with dedupe and freshness tracking.
- 🎯 **Matching & ranking** — separates *Match* from *Eligibility* (hard blockers like work authorization), then ranks each opportunity by an estimated **P(Interview)**.
- 📦 **Tailored packages** — per-role CV rewrite, summary, cover letter and screening answers, with a Truth Check and an auto / rule / approval policy for every answer.
- 🎙️ **Interview Room** — a room per round (recruiter, hiring manager, technical, final) with a prep pack and post-round debrief.
- 🧪 **Mock Interview** — persona-driven mock sessions (recruiter / hiring manager / technical) with transcript and scored feedback.
- 🤝 **Live Interview Copilot** — real-time support during interviews using the browser's speech recognition; no audio is stored, and it is disabled where the employer forbids external help.
- 💼 **Offer Desk** — benchmarks offers against market ranges, tracks negotiation, and surfaces a Career Score.
- 🛠️ **Admin & Partner roles** — operator dashboard (`/admin`) and partner/referral portal (`/partners`).

## 🖼️ Screenshots

<!-- Add product screenshots or a short demo GIF here, e.g. the dashboard, Interview Room and Offer Desk.
     ![Dashboard](docs/screenshots/dashboard.png) -->

> A live landing demo is available at **[simplify-career-landing.vercel.app](https://simplify-career-landing.vercel.app)**.

## ⚙️ How it works

The 60-day campaign runs as an autonomous loop, one cycle per active campaign:

```
Career Profile + Goal
        │
        ▼
  Discover ──▶ Match & rank ──▶ Prepare package ──▶ Submit / handoff
        ▲                                                   │
        │                                                   ▼
   Feedback loop ◀── Inbox intelligence ◀── Pipeline & interviews
        │
        ▼
   Offer Desk ──▶ Hired 🎉
```

Live vacancies are prepared as **user-authorized handoffs** (the package is ready and you submit through the official form), while demo vacancies flow through a simulated ATS adapter — no credential storage and no ToS-violating automation.

## 🧱 Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router) + React 19 |
| Language | TypeScript 5 |
| Database / ORM | Prisma 6 — SQLite for local dev, Postgres for production |
| Styling | Tailwind CSS 4 |
| AI | Anthropic SDK (Claude) with a deterministic engine fallback |
| Auth | `jose` (signed session JWTs) + `bcryptjs` |
| Supporting | `zod`, `unpdf` (CV parsing), `web-push` (PWA notifications) |
| Hosting | Vercel |

## 🚀 Getting Started

### Prerequisites

- Node.js 20+
- npm

### Install

```bash
git clone https://github.com/baimukhanalan/simplify-platform.git
cd simplify-platform
npm install
```

### Configure environment

Create a `.env` file:

```bash
DATABASE_URL="file:./dev.db"          # SQLite locally; switch the Prisma provider to postgresql for prod
SESSION_SECRET="<at least 32 random bytes>"
ANTHROPIC_API_KEY="<optional — enables Claude; omit to run the deterministic engine>"
SIMPLIFY_MODEL="claude-opus-5"        # optional, Claude model id
SIMPLIFY_MODE="simulation"            # optional showcase mode; unset = live engine
```

### Set up the database and run

```bash
npm run db:push    # or: npx prisma db push — creates prisma/dev.db
npm run seed       # demo scenario: Data Analyst from Almaty
npm run dev        # http://localhost:3000
```

Other scripts: `npm run build`, `npm start`, `npm run lint`, `npm test`.

### Demo accounts

The local seed creates (password `simplify2026` for all):

| Account | Role | Entry point |
|---|---|---|
| `aruzhan@simplify.kz` | user (active campaign) | `/app` |
| `admin@simplify.kz` | admin | `/admin` |
| `partner@amaskills.kz` | partner | `/partners` |

> Against Postgres the seed is a no-op unless you set `ALLOW_DEMO_SEED=1`, and staff accounts require `ADMIN_PASSWORD`.

## 🗂️ Project Structure

```
simplify-platform/
├── prisma/
│   ├── schema.prisma        # data model (SQLite); postgres/ holds the prod schema
│   └── seed.ts              # demo data entrypoint
├── src/
│   ├── app/                 # Next.js App Router
│   │   ├── app/             # authenticated product (agent, interviews, offers, pipeline, …)
│   │   ├── admin/           # operator dashboard
│   │   ├── partners/        # partner portal
│   │   └── api/             # route handlers (cron, payments, integrations, extension, …)
│   └── lib/
│       ├── engine/          # discovery, matching, personalization, interview, offer logic
│       ├── hh/ · sources/   # job sources and integrations
│       └── ai.ts            # Claude wrapper with engine fallback
└── extension/               # Manifest V3 "Apply Assist" browser extension
```

## 🗺️ Roadmap

- [x] Autonomous 60-day campaign loop (discover → rank → prepare → handoff)
- [x] Interview Room, Mock Interview and live Interview Copilot
- [x] Offer Desk with market benchmarking and Career Score
- [x] Manifest V3 "Apply Assist" extension for official application forms
- [x] hh.kz OAuth integration (per-owner credentials required)
- [ ] Gmail / Outlook inbox sync (currently paste-or-simulate)
- [ ] Additional official ATS submission integrations
- [ ] Expanded live job sources and regions

## 📄 License

Released under the [MIT License](LICENSE).
