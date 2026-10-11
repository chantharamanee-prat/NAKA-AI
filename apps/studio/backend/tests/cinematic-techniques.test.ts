/**
 * Cinematic techniques (core/generation/cinematic-techniques.ts): the catalogue, the picks (one per group), the
 * "Cinematography:" prompt line, and where picks are kept: a drama's metadata.cinematic, a product video's
 * studio_projects.cinematic (read through its hidden drama).
 */
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

process.env.DATABASE_URL = 'pglite://memory'
process.env.NAKA_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'naka-cine-'))
const { Hono } = await import('hono')
const { db, insertedId, schema, rawQuery } = await import('../src/core/db/index.js')
const { CINEMATIC_GROUPS, CINEMATIC_TECHNIQUES, normalizeCinematic, cinematicPrompt } = await import('../src/core/generation/cinematic-techniques.js')
const { getDramaCinematicPrompt, dramaIdOfStoryboard } = await import('../src/core/generation/style-preset.js')
const { default: cinematicRoute } = await import('../src/core/routes/cinematic.js')
const { default: dramas } = await import('../src/modules/drama/routes/dramas.js')

const app = new Hono()
app.route('/api/v1/cinematic-techniques', cinematicRoute)
app.route('/api/v1/dramas', dramas)
const ts = () => new Date().toISOString()

test('the catalogue: 150 techniques, unique ids, every group filled, Thai and English, no dashes in the copy', () => {
  assert.equal(CINEMATIC_TECHNIQUES.length, 150)
  assert.equal(new Set(CINEMATIC_TECHNIQUES.map(t => t.id)).size, 150)
  const counts = Object.fromEntries(CINEMATIC_GROUPS.map(g => [g.id, CINEMATIC_TECHNIQUES.filter(t => t.group === g.id).length]))
  assert.deepEqual(counts, { shot: 25, movement: 25, lighting: 30, composition: 20, lens: 20, look: 20, pacing: 10 })
  for (const t of CINEMATIC_TECHNIQUES) {
    assert.ok(t.id.startsWith(t.group + '.'), t.id)
    for (const field of ['name', 'nameTh', 'description', 'descriptionTh', 'prompt'] as const) assert.ok(t[field].trim(), `${t.id}.${field}`)
    assert.match(t.nameTh + t.descriptionTh, /[฀-๿]/, `${t.id} has Thai`)
    assert.doesNotMatch(JSON.stringify(t), /[–—]/, `${t.id} has no en or em dash`)
    assert.ok(t.prompt.length <= 120, `${t.id} prompt is short`)
  }
})

test('picks: unknown ids dropped, one per group, group order; movement and timing reach video only', () => {
  assert.deepEqual(normalizeCinematic(['look.noir', 'nope', 'shot.close-up', 'shot.wide', 'movement.orbit', 7]), ['shot.close-up', 'movement.orbit', 'look.noir'])
  assert.deepEqual(normalizeCinematic('shot.wide'), [])
  const picks = ['shot.low-angle', 'movement.push-in', 'lighting.golden-hour', 'pacing.slow-motion']
  assert.equal(cinematicPrompt(picks, 'video'),
    'Cinematography: low-angle shot looking up, subject appears powerful; slow push-in toward the subject; golden hour sunlight, warm and low; smooth slow motion')
  assert.equal(cinematicPrompt(picks, 'image'), 'Cinematography: low-angle shot looking up, subject appears powerful; golden hour sunlight, warm and low')
  assert.equal(cinematicPrompt(['movement.orbit'], 'image'), '')
  assert.equal(cinematicPrompt([], 'video'), '')
})

test('GET /cinematic-techniques lists the groups and all 150 techniques', async () => {
  const res = await app.request('/api/v1/cinematic-techniques')
  assert.equal(res.status, 200)
  const { data } = await res.json() as any
  assert.equal(data.techniques.length, 150); assert.equal(data.groups.length, 7)
})

test('a drama keeps its picks in metadata.cinematic (the rest of the metadata untouched); its shots get the line', async () => {
  const dramaId = insertedId(await db.insert(schema.dramas).values({ title: 'ละคร', metadata: JSON.stringify({ customStyle: 'ink wash' }),
    createdAt: ts(), updatedAt: ts() }).returning({ id: schema.dramas.id }))
  const res = await app.request(`/api/v1/dramas/${dramaId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cinematic: ['lighting.neon', 'lighting.moonlight', 'shot.dutch', 'bogus'] }) })
  assert.equal(res.status, 200)
  const [row] = await db.select().from(schema.dramas).where((await import('drizzle-orm')).eq(schema.dramas.id, dramaId))
  assert.deepEqual(JSON.parse(row.metadata!), { customStyle: 'ink wash', cinematic: ['shot.dutch', 'lighting.neon'] })
  assert.equal(await getDramaCinematicPrompt(dramaId, 'image'), 'Cinematography: Dutch angle, camera tilted about 20 degrees; neon signs lighting the scene, saturated colors')

  const episodeId = insertedId(await db.insert(schema.episodes).values({ dramaId, episodeNumber: 1, title: 'ตอน 1', createdAt: ts(), updatedAt: ts() } as any)
    .returning({ id: schema.episodes.id }))
  const [sb] = await rawQuery(`INSERT INTO storyboards (episode_id, storyboard_number, created_at, updated_at) VALUES ($1, 1, $2, $2) RETURNING id`, [episodeId, ts()])
  assert.equal(await dramaIdOfStoryboard(Number(sb.id)), dramaId)
  assert.equal(await dramaIdOfStoryboard(999999), null)
})

test('a product video keeps its picks on the project; its hidden drama reads them from there', async () => {
  const projectId = insertedId(await db.insert(schema.studioProjects).values({ title: 'ครีม', templateId: 'ugc_review',
    cinematic: JSON.stringify(['movement.product-turn', 'lighting.softbox-product']), createdAt: ts(), updatedAt: ts() } as any)
    .returning({ id: schema.studioProjects.id }))
  const dramaId = insertedId(await db.insert(schema.dramas).values({ title: 'ครีม', metadata: JSON.stringify({ studioProjectId: projectId }),
    createdAt: ts(), updatedAt: ts() }).returning({ id: schema.dramas.id }))
  assert.equal(await getDramaCinematicPrompt(dramaId, 'video'),
    'Cinematography: smooth 360-degree orbit around the product; large softbox product lighting, clean reflections')
  assert.equal(await getDramaCinematicPrompt(dramaId, 'image'), 'Cinematography: large softbox product lighting, clean reflections')
  assert.equal(await getDramaCinematicPrompt(null, 'video'), '')
})
