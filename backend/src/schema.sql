-- Ledger sales engagement platform schema
-- Run with: npm run migrate

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ---------------------------------------------------------------- orgs & users
CREATE TABLE IF NOT EXISTS orgs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  -- CAN-SPAM requires a real physical postal address in every commercial email
  postal_address  TEXT,
  reply_to_email  TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name          TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin','member')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_users_org ON users(org_id);

-- ---------------------------------------------------------------- products
CREATE TABLE IF NOT EXISTS products (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  tagline     TEXT,
  summary     TEXT,
  specs       JSONB NOT NULL DEFAULT '[]'::jsonb,  -- [{label, value}]
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_products_org ON products(org_id);

-- ---------------------------------------------------------------- leads
CREATE TABLE IF NOT EXISTS leads (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  category     TEXT,
  location     TEXT,
  email        TEXT,
  website      TEXT,
  description  TEXT,
  source_url   TEXT,
  -- where the row came from: 'search' | 'csv' | 'manual'
  origin       TEXT NOT NULL DEFAULT 'search',
  -- AI fit score 0-100 plus reasoning
  fit_score    INT,
  fit_reason   TEXT,
  status       TEXT NOT NULL DEFAULT 'new'
                 CHECK (status IN ('new','queued','contacted','replied','interested','not_interested','bounced','unsubscribed')),
  owner_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_leads_org ON leads(org_id);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(org_id, status);
-- prevent the same company being added twice within an org
CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_dedupe
  ON leads(org_id, lower(name), coalesce(lower(website),''));

-- ---------------------------------------------------------------- suppression
-- Anyone who opts out or hard-bounces lands here and can never be emailed again.
CREATE TABLE IF NOT EXISTS suppressions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  email       TEXT NOT NULL,
  reason      TEXT NOT NULL CHECK (reason IN ('unsubscribe','bounce','complaint','manual')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_suppress_unique ON suppressions(org_id, lower(email));

-- ---------------------------------------------------------------- campaigns
CREATE TABLE IF NOT EXISTS campaigns (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  product_id  UUID REFERENCES products(id) ON DELETE SET NULL,
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  name        TEXT NOT NULL,
  tone        TEXT NOT NULL DEFAULT 'Professional & concise',
  status      TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sending','sent','paused')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_campaigns_org ON campaigns(org_id);

-- ---------------------------------------------------------------- emails
CREATE TABLE IF NOT EXISTS emails (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  campaign_id   UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  lead_id       UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  to_email      TEXT NOT NULL,
  subject       TEXT NOT NULL,
  body          TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft','approved','sending','sent','failed','bounced')),
  provider_id   TEXT,          -- Resend message id, for matching webhook events
  error         TEXT,
  approved_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  sent_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_emails_campaign ON emails(campaign_id);
CREATE INDEX IF NOT EXISTS idx_emails_provider ON emails(provider_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_emails_one_per_lead ON emails(campaign_id, lead_id);

-- ---------------------------------------------------------------- events
-- Delivery/open/click/bounce/complaint events from the email provider.
CREATE TABLE IF NOT EXISTS email_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email_id    UUID REFERENCES emails(id) ON DELETE CASCADE,
  type        TEXT NOT NULL,   -- delivered | opened | clicked | bounced | complained
  payload     JSONB,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_events_email ON email_events(email_id);

-- ---------------------------------------------------------------- replies
-- Pasted-in or forwarded replies, classified by Claude.
CREATE TABLE IF NOT EXISTS replies (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  lead_id      UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  email_id     UUID REFERENCES emails(id) ON DELETE SET NULL,
  raw_text     TEXT NOT NULL,
  sentiment    TEXT CHECK (sentiment IN ('interested','not_interested','question','unsubscribe','out_of_office','other')),
  summary      TEXT,
  suggested_next_step TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_replies_lead ON replies(lead_id);

-- ---------------------------------------------------------------- competitors
CREATE TABLE IF NOT EXISTS competitors (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  website       TEXT,
  positioning   TEXT,     -- how they present themselves
  price_point   TEXT,     -- publicly listed pricing, if any
  strengths     TEXT,
  weaknesses    TEXT,
  source_url    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_competitors_org ON competitors(org_id);

-- Battlecards: how to position against a given competitor.
CREATE TABLE IF NOT EXISTS battlecards (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  competitor_id  UUID NOT NULL REFERENCES competitors(id) ON DELETE CASCADE,
  product_id     UUID REFERENCES products(id) ON DELETE SET NULL,
  content        JSONB NOT NULL,   -- {whereWeWin, whereTheyWin, objections:[{objection,response}]}
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_battlecards_comp ON battlecards(competitor_id);

-- ---------------------------------------------------------------- usage
-- Token + cost tracking per org, so you can see what the AI is costing you.
CREATE TABLE IF NOT EXISTS ai_usage (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  user_id        UUID REFERENCES users(id) ON DELETE SET NULL,
  operation      TEXT NOT NULL,   -- search_leads | draft_email | classify_reply | competitor_research | battlecard
  input_tokens   INT NOT NULL DEFAULT 0,
  output_tokens  INT NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_usage_org_date ON ai_usage(org_id, created_at);
