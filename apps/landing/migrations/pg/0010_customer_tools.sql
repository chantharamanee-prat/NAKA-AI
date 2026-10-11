-- Customer care tools on /admin/customers/ (src/admin/customer-tools.ts, docs/admin-backoffice.md):
-- internal notes and tags on a customer, credits for many customers at once, and the customer's data exported or
-- erased on request (PDPA). Runs as account_app with search_path = account; never name the schema here.

-- Notes only admins see, newest first on the customer's page. Gone with the customer's data when it is erased.
CREATE TABLE customer_notes (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body text NOT NULL CHECK (length(trim(body)) BETWEEN 1 AND 1000),
  author text NOT NULL DEFAULT '',
  created_at bigint NOT NULL
);
CREATE INDEX customer_notes_user ON customer_notes (user_id, created_at DESC);

-- Short labels ("VIP", "ขอคืนเงินแล้ว"): shown in the list, searchable, used to pick customers for bulk credits.
CREATE TABLE customer_tags (
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tag text NOT NULL CHECK (length(tag) BETWEEN 1 AND 30 AND tag !~ '[,\r\n]'),
  added_by text NOT NULL DEFAULT '',
  created_at bigint NOT NULL,
  PRIMARY KEY (user_id, tag)
);
CREATE INDEX customer_tags_tag ON customer_tags (lower(tag));

-- 'erase': the customer's data was erased (what was removed and what is kept is in detail).
-- 'export': an admin downloaded the customer's data. Both stay in the customer's history.
ALTER TABLE admin_audit DROP CONSTRAINT admin_audit_action_check;
ALTER TABLE admin_audit ADD CONSTRAINT admin_audit_action_check
  CHECK (action IN ('credits', 'package', 'status', 'password', 'feature', 'erase', 'export'));
