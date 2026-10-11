/**
 * Erasing one member's studio data (core/admin/erase-member.ts, GET /system/member-data, POST /system/erase-member):
 * every row they made, top-level and children, and their files under the storage folder; nobody else's.
 */
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

const dir = mkdtempSync(path.join(tmpdir(), 'naka-erase-'))
process.env.DATABASE_URL = 'pglite://memory'
process.env.NAKA_DATA_DIR = dir
const { Hono } = await import('hono')
const { rawQuery } = await import('../src/core/db/index.js')
const { ROWS, storedFile } = await import('../src/core/admin/erase-member.js')
const { default: system } = await import('../src/core/routes/system.js')
const app = new Hono()
app.route('/api/v1/system', system)

const ts = new Date().toISOString()
const id = async (sql: string, params: unknown[]) => Number((await rawQuery(sql + ' RETURNING id', params))[0].id)
function file(rel: string) {
  const full = path.join(dir, rel)
  mkdirSync(path.dirname(full), { recursive: true })
  writeFileSync(full, 'x')
  return full
}

/** one member's drama with an episode, a storyboard, a character and a task; a campaign; a social account with a post */
async function member(owner: string) {
  const drama = await id(`INSERT INTO dramas (title, owner_user_id, created_at, updated_at) VALUES ($1, $2, $3, $3)`, ['เรื่องของ ' + owner, owner, ts])
  const episode = await id(`INSERT INTO episodes (drama_id, episode_number, title, created_at, updated_at) VALUES ($1, 1, 'ตอน 1', $2, $2)`, [drama, ts])
  const board = await id(`INSERT INTO storyboards (episode_id, storyboard_number, video_url, created_at, updated_at) VALUES ($1, 1, $2, $3, $3)`,
    [episode, `/static/videos/${owner}-shot.mp4`, ts])
  const character = await id(`INSERT INTO characters (drama_id, name, local_path, created_at, updated_at) VALUES ($1, 'นาง', $2, $3, $3)`,
    [drama, `static/images/${owner}-face.png`, ts])
  await rawQuery(`INSERT INTO storyboard_characters (storyboard_id, character_id) VALUES ($1, $2)`, [board, character])
  await rawQuery(`INSERT INTO sys_task (type, owner_user_id, drama_id, local_path, created_at, updated_at) VALUES ('video', $1, $2, $3, $4, $4)`,
    [owner, drama, `static/videos/${owner}-task.mp4`, ts])
  await rawQuery(`INSERT INTO campaigns (title, owner_user_id, created_at, updated_at) VALUES ('แคมเปญ', $1, $2, $2)`, [owner, ts])
  const account = await id(`INSERT INTO social_accounts (platform, platform_account_id, owner_user_id, created_at, updated_at) VALUES ('facebook', $1, $1, $2, $2)`, [owner, ts])
  await rawQuery(`INSERT INTO social_posts (account_id, platform_post_id, created_at, updated_at) VALUES ($1, 'p1', $2, $2)`, [account, ts])
  return [file(`static/videos/${owner}-shot.mp4`), file(`static/images/${owner}-face.png`), file(`static/videos/${owner}-task.mp4`)]
}
const countFor = async (owner: string) => (await (await app.request('/api/v1/system/member-data?owner=' + owner)).json() as any).data

test('only stored paths inside the storage folder are files to remove', () => {
  const root = path.join(dir, 'static')
  assert.equal(storedFile('static/videos/a.mp4', root), path.join(root, 'videos', 'a.mp4'))
  assert.equal(storedFile('/static/a.png', root), path.join(root, 'a.png'))
  for (const outside of ['static/../../etc/passwd', '/etc/passwd', 'https://cdn.test/static/a.mp4', 'videos/a.mp4', '', null, 3]) {
    assert.equal(storedFile(outside, root), null, String(outside))
  }
})

test('every table that holds a member\'s work, or hangs off one, is in the erase list', async () => {
  const listed = new Set(ROWS.map(([table]) => table))
  const linked = await rawQuery(`SELECT DISTINCT table_name FROM information_schema.columns WHERE table_schema = current_schema()
    AND column_name IN ('owner_user_id', 'drama_id', 'episode_id', 'storyboard_id', 'campaign_id', 'creative_id', 'doc_id', 'character_id',
      'influencer_id', 'account_id')`)
  // project_id is also on studio_images / studio_shots / clone_variants, which are listed; these few hold no member data
  const notMemberData = new Set<string>()
  const missing = linked.map(r => String(r.table_name)).filter(t => !listed.has(t) && !notMemberData.has(t))
  assert.deepEqual(missing, [], 'a new table with an owner or a parent id must be added to ROWS in erase-member.ts')
})

test('count, then erase one member: their rows and files go, another member keeps everything', async () => {
  const mine = await member('m_erase')
  const theirs = await member('m_keep')

  const before = await countFor('m_erase')
  assert.equal(before.rows.dramas, 1); assert.equal(before.rows.storyboard_characters, 1); assert.equal(before.rows.social_posts, 1)
  assert.equal(before.total, 9)
  assert.deepEqual(await countFor('m_keep'), { ...before, owner: 'm_keep' })

  const res = await app.request('/api/v1/system/erase-member', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ owner: 'm_erase' }) })
  assert.equal(res.status, 200)
  const { data } = await res.json() as any
  assert.equal(data.total, 9)
  assert.deepEqual(data.files, { removed: 3, failed: 0 })
  assert.ok(mine.every(f => !existsSync(f)), 'their files are gone')
  assert.ok(theirs.every(f => existsSync(f)), 'nobody else\'s file is touched')
  assert.equal((await countFor('m_erase')).total, 0)
  assert.equal((await countFor('m_keep')).total, 9)
  const left = await rawQuery(`SELECT count(*)::int AS n FROM episodes e WHERE NOT EXISTS (SELECT 1 FROM dramas d WHERE d.id = e.drama_id)`)
  assert.equal(left[0].n, 0, 'no orphaned children')

  for (const bad of ['', 'local', 'a b']) {
    assert.equal((await app.request('/api/v1/system/erase-member', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ owner: bad }) })).status, 400, bad)
  }
})
