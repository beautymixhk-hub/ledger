# Ledger — AI Sales Engagement Platform

Find business customers, draft personalized outreach, send it, and track what comes back. Built for a small sales team.

---

## What it does

| Area | What happens |
|---|---|
| **Leads** | Claude searches the public web for businesses matching your description, scores each for fit, and stores them. Or import a CSV. |
| **Campaigns** | Claude drafts a personalized email per lead. You review and edit every one before anything sends. |
| **Sending** | Emails go out through Resend from your own verified domain, with your spec sheet, postal address, and unsubscribe link attached automatically. |
| **Replies** | Paste in what a prospect wrote. Claude classifies it (interested / not interested / question / opt-out) and updates the lead. |
| **Competitors** | Research competitors from public sources and generate battlecards your reps can use in calls. |
| **Dashboard** | Open rates, click rates, reply rates, pipeline by stage, and AI token spend. |

---

## Stack

- **Backend** — Node 20+, Express, PostgreSQL
- **Frontend** — React 18, Vite, React Router
- **AI** — Anthropic Claude API (with web search tool)
- **Email** — Resend

---

## Setup

### 1. Prerequisites

You'll need accounts for:

- **PostgreSQL** — locally, or a managed service ([Neon](https://neon.tech), [Supabase](https://supabase.com), AWS RDS). Free tiers are fine to start.
- **Anthropic API** — https://console.anthropic.com → API keys
- **Resend** — https://resend.com → API key, plus a verified sending domain
- **A domain name** you control (required for email — see below)

### 2. Database

```bash
cd backend
cp .env.example .env
```

Edit `.env` and fill in `DATABASE_URL`, `JWT_SECRET`, `ANTHROPIC_API_KEY`, `RESEND_API_KEY`, and the `MAIL_FROM_*` values.

Generate a JWT secret:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Then create the tables:

```bash
npm install
npm run migrate
```

### 3. Run it

```bash
# terminal 1
cd backend && npm run dev

# terminal 2
cd frontend && npm install && cp .env.example .env && npm run dev
```

Open http://localhost:5173, create an account, and you're in. The first user becomes the org admin.

### 4. Before you send a single email

In **Settings**, fill in:
- Your **physical mailing address** — sending is blocked without it (US law)
- Your **reply-to email** — a real inbox someone monitors
- Your **product spec** — this is what gets attached to every email

---

## Email deliverability — don't skip this

Cold email from an unconfigured domain goes straight to spam and can get your domain blacklisted. Before sending:

1. **Verify your domain in Resend.** They'll give you DNS records.
2. **Add SPF, DKIM, and DMARC records** to your DNS. All three.
3. **Use a subdomain** for outreach (`mail.yourcompany.com`), not your main domain. If deliverability goes bad, your primary domain isn't affected.
4. **Warm up slowly.** Start at 20–30 emails a day for the first two weeks. Ramp up gradually. Blasting 500 on day one is the fastest way to get blocked.
5. **Set the webhook.** In Resend, point delivery events at `https://your-api-domain.com/api/webhooks/resend` so opens, clicks, and bounces flow back in.

The app has hard caps built in (`MAX_EMAILS_PER_CAMPAIGN`, `MAX_EMAILS_PER_DAY_PER_ORG` in `.env`). Keep them low at first.

---

## Legal requirements you are responsible for

The software helps you comply, but compliance is on you, not the tool.

**CAN-SPAM (US).** Every commercial email must have a real physical postal address, a working opt-out that you honor within 10 business days, an accurate "from" line, and a non-deceptive subject. The app enforces the address and unsubscribe link, and suppresses opt-outs permanently and automatically. It cannot stop you from writing a misleading subject line.

**FDA (device marketing).** A pelvic floor therapy device is likely a regulated medical device in the US. Importing it for commercial sale and marketing it with therapeutic claims carries real requirements — registration, listing, possibly 510(k) clearance. The AI prompts are written to avoid efficacy claims, but **get proper regulatory advice before you start selling.** A prompt instruction is not a compliance program.

**State privacy laws.** Some states have their own rules on commercial messaging. If you're emailing into California, Virginia, Colorado and others, check what applies.

The lead search only returns **businesses**, never private individuals, and the prompts instruct the model never to guess an email address. That's a deliberate design choice — guessed addresses damage deliverability and scraping personal contact details creates legal exposure.

---

## Deployment

**Frontend** → Vercel or Netlify. Build command `npm run build`, output `dist`. Set `VITE_API_URL` to your API's public URL.

**Backend** → Railway, Render, Fly.io, or any Node host. Set every variable from `.env.example` in the host's environment config. Never commit `.env`.

**Database** → Use a managed Postgres with automated backups. Run `npm run migrate` once against the production database.

After deploying, update `APP_URL` and `API_URL` in the backend environment to the real domains, or CORS and unsubscribe links will break.

---

## Cost

Two things cost money per use:

- **Claude API** — lead search is the expensive one because of web search calls. A 10-result search runs roughly a few cents. Email drafting is cheaper. The Dashboard tracks your 30-day token spend.
- **Resend** — free tier covers 3,000 emails/month; paid plans beyond that.

---

## Project structure

```
backend/
  src/
    server.js              Express app, routes, rate limits
    db.js                  Postgres pool + transaction helper
    schema.sql             Full database schema
    migrate.js             Applies the schema
    middleware/auth.js     JWT auth, admin guard
    routes/
      auth.js              Register, login, team, org settings
      leads.js             AI search, CSV import, filtering
      campaigns.js         Draft, approve, send
      competitors.js       Research, battlecards
      feedback.js          Reply classification, stats
      products.js          Product spec CRUD
      public.js            Unsubscribe + Resend webhooks (no auth)
    services/
      claude.js            All Claude API calls
      email.js             Compose, suppression checks, sending
frontend/
  src/
    App.jsx                Shell, routing, auth guard
    api.js                 API client
    styles.css             Design system
    pages/                 Dashboard, Leads, Campaigns, CampaignDetail,
                           Replies, Competitors, Settings, Login
```

---

## Things worth knowing

**Nothing sends automatically.** Every email is drafted, then reviewed by a human, then approved, then sent. That's deliberate — automated cold email at volume without review is how companies get blacklisted and sued.

**The suppression list is permanent.** Once someone opts out or hard-bounces, they can't be emailed again from this system, and there's no UI to undo it. That's on purpose.

**AI output needs checking.** Claude won't invent businesses if the prompt is followed, but search results can still be stale or wrong. Have reps verify a lead's website before contacting them.

**Deduplication is by name + website** within an org, so running the same search twice won't create duplicates.
