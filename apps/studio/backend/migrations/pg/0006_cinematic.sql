-- Cinematic techniques picked for a product video (src/core/generation/cinematic-techniques.ts): a JSON array of
-- technique ids, at most one per group. Short dramas keep theirs in dramas.metadata.cinematic. NULL = none picked.
ALTER TABLE "studio_projects" ADD COLUMN IF NOT EXISTS "cinematic" text;
