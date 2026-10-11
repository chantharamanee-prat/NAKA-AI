<template>
  <fieldset class="cine">
    <legend class="field-label">{{ t('components.cinematic.title') }}</legend>
    <p class="field-hint">{{ t('components.cinematic.hint') }}</p>
    <p v-if="error" class="field-hint cine-error" role="status">{{ t('components.cinematic.loadError') }}</p>

    <!-- moods: one tap picks techniques that work together; tap again to undo -->
    <div class="cine-presets" role="group" :aria-label="t('components.cinematic.moods')">
      <button v-for="p in presets" :key="p.id" type="button" :class="['cine-preset', { on: activePreset === p.id }]"
        :aria-pressed="activePreset === p.id" @click="applyPreset(p)">
        <span class="cine-thumb">
          <img v-if="!artFailed['preset.' + p.id]" :src="cinematicArt('preset.' + p.id)" alt="" loading="lazy" decoding="async"
            width="720" height="411" @error="artFailed['preset.' + p.id] = true">
          <Check v-if="activePreset === p.id" class="cine-check" :size="18" :stroke-width="3" aria-hidden="true" />
        </span>
        <b class="cine-preset-name">{{ th ? p.nameTh : p.name }}</b>
        <span class="cine-preset-desc">{{ th ? p.descriptionTh : p.description }}</span>
      </button>
    </div>

    <p v-if="modelValue.length" class="cine-summary" role="status">
      <span><b>{{ t('components.cinematic.picked') }}</b> {{ pickedNames }}</span>
      <button type="button" class="btn btn-ghost btn-sm" @click="emit('update:modelValue', [])">{{ t('components.cinematic.clear') }}</button>
    </p>

    <button type="button" class="btn btn-ghost btn-sm cine-toggle" :aria-expanded="custom" @click="custom = !custom">
      <SlidersHorizontal :size="15" aria-hidden="true" />
      {{ custom ? t('components.cinematic.customHide') : t('components.cinematic.custom') }}
    </button>

    <!-- custom: one row of example pictures per group, so nobody has to know the camera words -->
    <div v-if="custom" class="cine-groups">
      <p class="field-hint">{{ t('components.cinematic.customHint') }}</p>
      <section v-for="g in groups" :key="g.id" class="cine-group" :aria-labelledby="`cine-g-${uid}-${g.id}`">
        <h4 :id="`cine-g-${uid}-${g.id}`" class="cine-group-label">{{ th ? g.nameTh : g.name }}</h4>
        <div class="cine-row" role="group" :aria-labelledby="`cine-g-${uid}-${g.id}`">
          <button type="button" :class="['cine-opt', 'cine-opt-auto', { on: !pick(g.id) }]" :aria-pressed="!pick(g.id)" @click="choose(g.id, '')">
            <span class="cine-thumb cine-thumb-auto"><Sparkles :size="20" aria-hidden="true" /></span>
            <span class="cine-opt-name">{{ t('components.cinematic.auto') }}</span>
          </button>
          <button v-for="x in optionsFor(g.id)" :key="x.id" type="button" :class="['cine-opt', { on: pick(g.id) === x.id }]"
            :aria-pressed="pick(g.id) === x.id" :title="th ? x.descriptionTh : x.description" @click="choose(g.id, x.id)">
            <span class="cine-thumb">
              <img v-if="!artFailed[x.id]" :src="cinematicArt(x.id)" alt="" loading="lazy" decoding="async" width="720" height="411"
                @error="artFailed[x.id] = true">
            </span>
            <span class="cine-opt-name">{{ th ? x.nameTh : x.name }}</span>
          </button>
        </div>
        <span v-if="pick(g.id)" class="cine-desc">{{ describe(pick(g.id)) }}</span>
      </section>
    </div>
  </fieldset>
</template>

<script setup>
/**
 * Pick cinematic techniques for a video, made for members who do not speak camera: tap a mood (a preset that picks
 * several techniques at once), or open "customize" and pick by example picture, at most one per group (shot,
 * movement, lighting, composition, lens, look, timing). v-model is an array of technique ids; the backend turns them
 * into agent instructions and a "Cinematography:" prompt line (backend core/generation/cinematic-techniques.ts).
 * Picking nothing is fine: the AI decides. The catalogue is fetched once per page.
 */
import { computed, onMounted, reactive, ref, useId } from 'vue'
import { useI18n } from 'vue-i18n'
import { Check, SlidersHorizontal, Sparkles } from 'lucide-vue-next'
import { useCinematicTechniques } from '~/composables/useCinematicTechniques'
import { cinematicArt } from '~/utils/studioArt'

const props = defineProps({ modelValue: { type: Array, default: () => [] } })
const emit = defineEmits(['update:modelValue'])
const { t, locale } = useI18n()
const { groups, techniques, presets, load, error } = useCinematicTechniques()
onMounted(load)
const uid = useId()

const th = computed(() => String(locale.value).startsWith('th'))
const byId = computed(() => new Map(techniques.value.map(x => [x.id, x])))
// example pictures (public/studio-art/cinematic): a missing one leaves the text
const artFailed = reactive({})
const custom = ref(false)

function optionsFor(group) { return techniques.value.filter(x => x.group === group) }
function pick(group) { return props.modelValue.find(id => byId.value.get(id)?.group === group) || '' }
function describe(id) { const x = byId.value.get(id); return x ? (th.value ? x.descriptionTh : x.description) : '' }
function choose(group, id) {
  const rest = props.modelValue.filter(v => byId.value.get(v)?.group !== group)
  emit('update:modelValue', id ? [...rest, id] : rest)
}

// the preset whose picks are exactly the current picks (changing one group afterwards leaves "custom")
const activePreset = computed(() => {
  const now = [...props.modelValue].sort().join()
  return presets.value.find(p => [...p.picks].sort().join() === now)?.id || ''
})
function applyPreset(p) { emit('update:modelValue', activePreset.value === p.id ? [] : [...p.picks]) }
const pickedNames = computed(() => props.modelValue.map(id => byId.value.get(id)).filter(Boolean)
  .map(x => (th.value ? x.nameTh : x.name)).join(t('common.listJoin')))
</script>

<style scoped>
.cine { border: 0; padding: 0; margin: 0; min-width: 0; }
.cine-error { color: var(--danger, #c0392b); }

.cine-presets { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; margin-top: 10px; }
.cine-preset {
  display: flex; flex-direction: column; gap: 3px; min-width: 0; padding: 0 0 10px; text-align: left; cursor: pointer;
  border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--surface-raised); color: var(--text-1); overflow: hidden;
}
.cine-preset:hover { border-color: var(--text-3); }
.cine-preset.on { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
.cine-preset:focus-visible, .cine-opt:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.cine-preset-name { padding: 4px 10px 0; font-size: 14px; color: var(--text-0); }
.cine-preset-desc { padding: 0 10px; font-size: 12px; line-height: 1.45; color: var(--text-2); }

.cine-thumb { position: relative; display: block; aspect-ratio: 720 / 411; background: var(--bg-hover); overflow: hidden; }
.cine-thumb img { display: block; width: 100%; height: 100%; object-fit: cover; }
.cine-check {
  position: absolute; top: 6px; right: 6px; padding: 3px; border-radius: 999px;
  background: var(--accent); color: #fff; box-sizing: content-box;
}

.cine-summary {
  display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap;
  margin: 10px 0 0; padding: 8px 12px; border-radius: var(--radius-md, 10px); background: var(--bg-hover); font-size: 13px; color: var(--text-1);
}
.cine-toggle { display: inline-flex; align-items: center; gap: 6px; margin-top: 10px; min-height: 40px; }

.cine-groups { display: grid; gap: 14px; margin-top: 6px; }
.cine-group { display: grid; gap: 6px; min-width: 0; }
.cine-group-label { margin: 0; font-size: 13px; font-weight: 700; color: var(--text-1); }
/* a sideways row: the next card peeks and the edge fades, so it reads as scrollable */
.cine-row {
  display: flex; gap: 8px; overflow-x: auto; padding: 2px 2px 6px; scroll-snap-type: x proximity; overscroll-behavior-x: contain;
  -webkit-mask-image: linear-gradient(to right, #000 calc(100% - 28px), transparent);
  mask-image: linear-gradient(to right, #000 calc(100% - 28px), transparent);
}
.cine-opt {
  flex: 0 0 128px; display: flex; flex-direction: column; gap: 4px; padding: 0 0 6px; scroll-snap-align: start; cursor: pointer; text-align: left;
  border: 1px solid var(--border); border-radius: var(--radius-md, 10px); background: var(--surface-raised); color: var(--text-1); overflow: hidden;
}
.cine-opt.on { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
.cine-opt-name { padding: 0 8px; font-size: 12px; font-weight: 600; line-height: 1.35; }
.cine-thumb-auto { display: grid; place-items: center; color: var(--accent); }
.cine-desc { font-size: 12px; color: var(--text-2); line-height: 1.45; }
@media (prefers-reduced-motion: no-preference) { .cine-preset, .cine-opt { transition: border-color .15s ease, box-shadow .15s ease; } }
</style>
