/**
 * Cinematic techniques in the UI (backend core/generation/cinematic-techniques.ts): one shared picker on the drama
 * settings, the product-video create dialog and its workspace settings, a shelf of all 150 in the skills library,
 * and the texts in both languages.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const picker = read('app/components/CinematicPicker.vue')
const detail = read('menus/drama/views/detail.vue')
const studio = read('menus/product-studio/pages/studio.vue')
const workspace = read('menus/product-studio/views/workspace.vue')
const library = read('menus/product-studio/components/StudioSkillsLibrary.vue')

test('the picker: one choice per group, emitted as technique ids', () => {
  assert.match(picker, /useCinematicTechniques/)
  assert.match(picker, /props\.modelValue\.filter\(v => byId\.value\.get\(v\)\?\.group !== group\)/, 'choosing replaces the same group')
  assert.match(picker, /components\.cinematic\.none/)
})

test('menu pages import the picker (menus are Nuxt layers: shared components are not auto-registered there)', () => {
  for (const [name, src] of [['detail', detail], ['studio', studio], ['workspace', workspace]]) {
    assert.match(src, /import CinematicPicker from '~\/components\/CinematicPicker\.vue'/, name)
  }
  assert.match(picker, /import BaseSelect from '~\/components\/BaseSelect\.vue'/)
  assert.match(picker, /import \{ useI18n \} from 'vue-i18n'/, 'no auto-imports here: without it the picker never renders')
})

test('drama settings and both product-video forms carry the picks', () => {
  assert.match(detail, /<CinematicPicker v-model="positioningForm\.cinematic" \/>/)
  assert.match(detail, /positioningForm\.cinematic = Array\.isArray\(m\.cinematic\)/)
  assert.match(studio, /<CinematicPicker v-model="projectForm\.cinematic" \/>/)
  assert.match(studio, /cinematic: projectForm\.value\.cinematic,/)
  assert.match(studio, /cinematic: nextCinematic\(\)/, 'the next video starts from the shelf picks')
  assert.match(workspace, /<CinematicPicker v-model="settingsDraft\.cinematic" \/>/)
  assert.match(workspace, /cinematic: s\.cinematic,/)
})

test('the skills library has a shelf of the techniques with group chips and a pick for the next video', () => {
  assert.match(library, /id: 'cinematic', label: t\('components\.cinematic\.shelf'\)/)
  assert.match(library, /v-for="g in cineGroups"/)
  assert.match(library, /@click="toggleNext\(x\.id\)"/)
  assert.match(library, /emit\('new-video'\)/)
  assert.match(studio, /@new-video="switchTab\('projects'\); openCreate\(\)"/)
})

test('both languages have every cinematic text', () => {
  const keys = ['title', 'hint', 'none', 'clear', 'loadError', 'shelf', 'shelfHint', 'use', 'used', 'pending']
  for (const lang of ['th', 'en']) {
    const texts = JSON.parse(read(`app/locales/${lang}.json`)).components.cinematic
    for (const k of keys) assert.ok(texts[k], `${lang}: components.cinematic.${k}`)
    assert.doesNotMatch(JSON.stringify(texts), /[–—]/)
  }
})
