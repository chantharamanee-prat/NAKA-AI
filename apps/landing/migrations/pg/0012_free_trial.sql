-- Free trial (docs/entitlements.md): for the first 7 days after sign-up, a member without a paid plan gets
-- plan 'trial', which includes every landing area and every studio menu. After that they fall back to 'free'.
-- A paid, active subscription always wins over the trial.
--
-- 'trial' is a plan row like the others so the owner tunes what it includes in /admin/system/ (plan matrix);
-- price 0 and on_sale 0 keep it out of checkout, coupons and the admin "package" picker (they list
-- price_thb > 0). Credits are unchanged: credits.ts still treats a member without a subscription as 'free',
-- so jobs are priced as before and the sign-up bonus is what a new member spends.
--
-- Runs as account_app with search_path = account; never names its schema (see 0002_shared.sql).

INSERT INTO plans (id, name, monthly_credits, max_parallel_jobs, price_thb, on_sale)
VALUES ('trial', 'ทดลองใช้ 7 วัน', 0, 1, 0, 0)
ON CONFLICT (id) DO NOTHING;

-- every feature; the quota features keep the starter plan's monthly limits (video stays capped)
INSERT INTO plan_features (plan_id, feature_key, monthly_limit)
SELECT 'trial', f.key, CASE WHEN f.quota_unit IS NULL THEN NULL ELSE sf.monthly_limit END
FROM features f
LEFT JOIN plan_features sf ON sf.plan_id = 'starter' AND sf.feature_key = f.key
ON CONFLICT (plan_id, feature_key) DO NOTHING;

-- trial_days() is the one place the length lives; the home page says "7 วัน" and a test keeps them equal
CREATE FUNCTION trial_days() RETURNS bigint LANGUAGE sql IMMUTABLE AS $$ SELECT 7::bigint $$;

-- same answer as 0003, with one change in how the current plan is chosen:
--   active, unexpired subscription → its plan; else account younger than trial_days() → 'trial'; else 'free'
CREATE OR REPLACE FUNCTION member_features(p_user text)
RETURNS TABLE (feature_key text, app text, label text, quota_unit text, enabled boolean,
               monthly_limit bigint, used bigint, source text, plan_id text)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  WITH t AS (SELECT extract(epoch FROM now())::bigint AS now_s, feature_period() AS period),
  member AS (
    SELECT u.status,
      coalesce((SELECT s.plan_id FROM subscriptions s WHERE s.user_id = u.id AND s.status = 'active'
                  AND (s.expires_at IS NULL OR s.expires_at > t.now_s)),
               CASE WHEN u.created_at > t.now_s - trial_days() * 86400 THEN 'trial' ELSE 'free' END) AS plan_id
    FROM users u CROSS JOIN t WHERE u.id = p_user
  )
  SELECT f.key, f.app, f.label, f.quota_unit,
    coalesce(m.status = 'active', false) AND CASE WHEN o.user_id IS NOT NULL THEN o.enabled ELSE pf.plan_id IS NOT NULL END,
    CASE WHEN f.quota_unit IS NULL THEN NULL
         WHEN o.user_id IS NOT NULL AND o.monthly_limit IS NOT NULL THEN o.monthly_limit
         ELSE pf.monthly_limit END,
    coalesce(fu.used, 0),
    CASE WHEN o.user_id IS NOT NULL THEN 'override' WHEN pf.plan_id IS NOT NULL THEN 'plan' ELSE 'none' END,
    m.plan_id
  FROM features f CROSS JOIN t
  LEFT JOIN member m ON true
  LEFT JOIN plan_features pf ON pf.feature_key = f.key AND pf.plan_id = m.plan_id
  LEFT JOIN user_features o ON o.feature_key = f.key AND o.user_id = p_user AND (o.expires_at IS NULL OR o.expires_at > t.now_s)
  LEFT JOIN feature_usage fu ON fu.user_id = p_user AND fu.feature_key = f.key AND fu.period = t.period
  ORDER BY f.sort_order, f.key
$$;

-- CREATE OR REPLACE keeps the grants (studio_app EXECUTE) but drops the function's SET clause: put it back
DO $$
DECLARE
  s text := quote_ident(current_schema());
BEGIN
  EXECUTE format('ALTER FUNCTION member_features(text) SET search_path = %s, pg_temp', s);
  EXECUTE format('ALTER FUNCTION trial_days() SET search_path = %s, pg_temp', s);
  EXECUTE format('REVOKE ALL ON FUNCTION trial_days() FROM PUBLIC');
END $$;
