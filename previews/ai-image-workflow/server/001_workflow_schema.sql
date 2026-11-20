-- REVIEW ONLY. NOT APPLIED. Existing database, identity, RLS and deployment need confirmation.
-- Intended transaction: insert receipt + immutable intent + outbox event together.
CREATE TABLE IF NOT EXISTS image_workflow_receipts (
  id uuid PRIMARY KEY,
  actor_subject text NOT NULL,
  request_key text NOT NULL,
  request_hash char(64) NOT NULL,
  intent jsonb NOT NULL,
  status text NOT NULL CHECK(status IN ('accepted-not-executed','running','uncertain','failed','completed','cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(actor_subject,request_key)
);
CREATE TABLE IF NOT EXISTS image_workflow_outbox (
  id uuid PRIMARY KEY REFERENCES image_workflow_receipts(id),
  asset_id text,
  output_sha256 char(64),
  target text,
  payload jsonb NOT NULL,
  state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','leased','uncertain','failed','completed','cancelled')),
  lease_until timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  result_receipt jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- Do not add public browser write policies. Authenticated server adapter only.
ALTER TABLE image_workflow_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE image_workflow_outbox ENABLE ROW LEVEL SECURITY;
-- No GRANT, secret, identity-provider choice or deployed policy is included in this draft.
