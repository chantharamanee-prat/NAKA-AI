/**
 * Erase everything one naka-ai member made in the studio (PDPA request, the landing's /admin/customers/ "ลบข้อมูล").
 *
 * The studio has no foreign keys: top-level rows carry owner_user_id, their children point at them by id only. So the
 * member's rows are found from the top (dramas, campaigns, clone projects, product projects, influencers, social
 * accounts, avatars, seller posts, insights, tasks) down to every child, and all of it is deleted in ONE statement
 * (data-modifying CTEs see one snapshot, so it is all or nothing). The files those rows point at under the storage
 * folder are removed afterwards; a file that cannot be removed is counted, never fatal.
 */
import { promises as fs } from 'fs'
import path from 'path'
import { rawQuery } from '../db/index.js'
import { STORAGE_ROOT } from '../utils/paths.js'

/** id sets, from the member's top-level rows down; $1 = owner */
const IDS = `
  d   AS (SELECT id FROM dramas WHERE owner_user_id = $1),
  e   AS (SELECT id FROM episodes WHERE drama_id IN (SELECT id FROM d)),
  sb  AS (SELECT id FROM storyboards WHERE episode_id IN (SELECT id FROM e)),
  ch  AS (SELECT id FROM characters WHERE drama_id IN (SELECT id FROM d)),
  cp  AS (SELECT id FROM campaigns WHERE owner_user_id = $1),
  cr  AS (SELECT id FROM campaign_creatives WHERE campaign_id IN (SELECT id FROM cp)),
  cd  AS (SELECT id FROM campaign_docs WHERE campaign_id IN (SELECT id FROM cp)),
  cl  AS (SELECT id FROM clone_projects WHERE owner_user_id = $1),
  pj  AS (SELECT id FROM studio_projects WHERE owner_user_id = $1),
  inf AS (SELECT id FROM studio_influencers WHERE owner_user_id = $1),
  acc AS (SELECT id FROM social_accounts WHERE owner_user_id = $1)`

/** table → which of its rows belong to the member */
export const ROWS: [string, string][] = [
  ['storyboard_character_looks', 'storyboard_id IN (SELECT id FROM sb)'],
  ['storyboard_characters', 'storyboard_id IN (SELECT id FROM sb)'],
  ['storyboard_media_selections', 'storyboard_id IN (SELECT id FROM sb)'],
  ['storyboard_props', 'storyboard_id IN (SELECT id FROM sb)'],
  ['studio_shots', 'storyboard_id IN (SELECT id FROM sb) OR project_id IN (SELECT id FROM pj)'],
  ['storyboards', 'id IN (SELECT id FROM sb)'],
  ['episode_characters', 'episode_id IN (SELECT id FROM e)'],
  ['episode_props', 'episode_id IN (SELECT id FROM e)'],
  ['episode_scenes', 'episode_id IN (SELECT id FROM e)'],
  ['character_looks', 'character_id IN (SELECT id FROM ch)'],
  ['characters', 'id IN (SELECT id FROM ch)'],
  ['props', 'drama_id IN (SELECT id FROM d)'],
  ['scenes', 'drama_id IN (SELECT id FROM d) OR episode_id IN (SELECT id FROM e)'],
  ['assets', 'drama_id IN (SELECT id FROM d) OR episode_id IN (SELECT id FROM e)'],
  ['pipeline_tasks', 'drama_id IN (SELECT id FROM d) OR episode_id IN (SELECT id FROM e)'],
  ['video_merges', 'drama_id IN (SELECT id FROM d) OR episode_id IN (SELECT id FROM e)'],
  ['clone_variants', 'project_id IN (SELECT id FROM cl) OR episode_id IN (SELECT id FROM e)'],
  ['episodes', 'id IN (SELECT id FROM e)'],
  ['dramas', 'id IN (SELECT id FROM d)'],
  ['campaign_ad_references', 'campaign_id IN (SELECT id FROM cp)'],
  ['campaign_visuals', 'campaign_id IN (SELECT id FROM cp)'],
  ['creative_results', 'creative_id IN (SELECT id FROM cr)'],
  ['campaign_creatives', 'id IN (SELECT id FROM cr)'],
  ['campaign_doc_revisions', 'doc_id IN (SELECT id FROM cd)'],
  ['campaign_docs', 'id IN (SELECT id FROM cd)'],
  ['campaigns', 'id IN (SELECT id FROM cp)'],
  ['clone_projects', 'id IN (SELECT id FROM cl)'],
  ['studio_images', 'project_id IN (SELECT id FROM pj)'],
  ['studio_projects', 'id IN (SELECT id FROM pj)'],
  ['studio_influencer_contents', 'influencer_id IN (SELECT id FROM inf)'],
  ['studio_influencers', 'id IN (SELECT id FROM inf)'],
  ['social_comments', 'account_id IN (SELECT id FROM acc)'],
  ['social_posts', 'account_id IN (SELECT id FROM acc)'],
  ['social_accounts', 'id IN (SELECT id FROM acc)'],
  ['seller_posts', 'owner_user_id = $1'],
  ['studio_avatars', 'owner_user_id = $1'],
  ['marketer_insights', 'owner_user_id = $1'],
  ['sys_task', 'owner_user_id = $1 OR drama_id IN (SELECT id FROM d)'],
]

/** columns that may name a file under the storage folder ('static/…' or '/static/…') */
const FILES: [string, string[]][] = [
  ['sys_task', ['local_path', 'result_url']], ['characters', ['local_path', 'image_url']], ['character_looks', ['image_url']],
  ['props', ['local_path', 'image_url']], ['scenes', ['local_path', 'image_url']], ['assets', ['local_path', 'url', 'thumbnail_url']],
  ['storyboards', ['video_url', 'composed_video_url', 'subtitle_url']], ['episodes', ['video_url']], ['video_merges', ['merged_url', 'subtitle_url']],
  ['clone_variants', ['output_path']], ['clone_projects', ['reference_path']], ['seller_posts', ['video_url']],
  ['studio_avatars', ['image_url']], ['studio_influencers', ['image_url']],
]

export interface EraseResult { owner: string; rows: Record<string, number>; total: number; files: { removed: number; failed: number } }

/** The file a stored value points at, only when it is inside the storage folder. */
export function storedFile(value: unknown, root = STORAGE_ROOT): string | null {
  if (typeof value !== 'string') return null
  const rel = value.startsWith('/static/') ? value.slice(1) : value
  if (!rel.startsWith('static/')) return null
  const base = path.resolve(root)
  const full = path.resolve(base, '..', rel)
  return full.startsWith(base + path.sep) ? full : null
}

/** What eraseMember would delete, without deleting: rows per table (the confirmation step on the landing). */
export async function countMember(owner: string): Promise<{ owner: string; rows: Record<string, number>; total: number }> {
  if (!owner || owner === 'local' || owner.length > 128) throw new Error('owner is required')
  const counts = ROWS.map(([table, where]) => `(SELECT count(*) FROM ${table} WHERE ${where})::int AS "${table}"`).join(', ')
  const [row] = await rawQuery(`WITH ${IDS} SELECT ${counts}`, [owner])
  const rows: Record<string, number> = {}
  let total = 0
  for (const [table] of ROWS) { const n = Number(row?.[table] ?? 0); if (n) rows[table] = n; total += n }
  return { owner, rows, total }
}

export async function eraseMember(owner: string): Promise<EraseResult> {
  if (!owner || owner === 'local' || owner.length > 128) throw new Error('owner is required')
  // the files first: after the delete nothing points at them any more
  const fileSql = FILES.map(([table, cols]) => `SELECT unnest(ARRAY[${cols.join(', ')}]) AS f FROM ${table} WHERE ${ROWS.find(([t]) => t === table)![1]}`).join('\nUNION ALL\n')
  const files = (await rawQuery(`WITH ${IDS} SELECT DISTINCT f FROM (${fileSql}) x WHERE f IS NOT NULL AND f <> ''`, [owner]))
    .map(r => storedFile(r.f)).filter((f): f is string => !!f)

  const deletes = ROWS.map(([table, where], i) => `x${i} AS (DELETE FROM ${table} WHERE ${where} RETURNING 1)`).join(',\n  ')
  const counts = ROWS.map(([table], i) => `(SELECT count(*) FROM x${i})::int AS "${table}"`).join(', ')
  const [row] = await rawQuery(`WITH ${IDS},\n  ${deletes}\nSELECT ${counts}`, [owner])
  const rows: Record<string, number> = {}
  let total = 0
  for (const [table] of ROWS) { const n = Number(row?.[table] ?? 0); if (n) rows[table] = n; total += n }

  let removed = 0, failed = 0
  for (const file of new Set(files)) {
    try { await fs.rm(file, { force: true }); removed++ } catch { failed++ }
  }
  return { owner, rows, total, files: { removed, failed } }
}
