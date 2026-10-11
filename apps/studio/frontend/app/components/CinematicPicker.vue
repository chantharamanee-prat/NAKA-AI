<template>
  <fieldset class="cine">
    <legend class="field-label">{{ t('components.cinematic.title') }}</legend>
    <p class="field-hint">{{ t('components.cinematic.hint') }}</p>
    <p v-if="error" class="field-hint cine-error" role="status">{{ t('components.cinematic.loadError') }}</p>
    <div class="cine-grid">
      <div v-for="g in groups" :key="g.id" class="cine-group">
        <span class="cine-group-label">{{ groupName(g) }}</span>
        <BaseSelect :model-value="pick(g.id)" :options="optionsFor(g.id)" searchable
          :placeholder="t('components.cinematic.none')" @update:model-value="v => choose(g.id, v)" />
        <span v-if="pick(g.id)" class="cine-desc">{{ describe(pick(g.id)) }}</span>
      </div>
    </div>
    <button v-if="modelValue.length" type="button" class="btn btn-ghost btn-sm cine-clear" @click="emit('update:modelValue', [])">
      {{ t('components.cinematic.clear') }}
    </button>
  </fieldset>
</template>

<script setup>
/**
 * Pick cinematic techniques for a video: at most one per group (shot, movement, lighting, composition, lens, look,
 * timing). v-model is an array of technique ids; the backend turns them into a "Cinematography:" prompt line
 * (backend core/generation/cinematic-techniques.ts). The catalogue is fetched once per page.
 */
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import BaseSelect from '~/components/BaseSelect.vue'
import { useCinematicTechniques } from '~/composables/useCinematicTechniques'

const props = defineProps({ modelValue: { type: Array, default: () => [] } })
const emit = defineEmits(['update:modelValue'])
const { t, locale } = useI18n()
const { groups, techniques, load, error } = useCinematicTechniques()
onMounted(load)

const th = computed(() => String(locale.value).startsWith('th'))
const byId = computed(() => new Map(techniques.value.map(x => [x.id, x])))
const groupName = g => (th.value ? g.nameTh : g.name)
const nameOf = x => (th.value ? x.nameTh : x.name)
function optionsFor(group) {
  return [{ label: t('components.cinematic.none'), value: '' },
    ...techniques.value.filter(x => x.group === group).map(x => ({ label: nameOf(x), value: x.id }))]
}
function pick(group) { return props.modelValue.find(id => byId.value.get(id)?.group === group) || '' }
function describe(id) { const x = byId.value.get(id); return x ? (th.value ? x.descriptionTh : x.description) : '' }
function choose(group, id) {
  const rest = props.modelValue.filter(v => byId.value.get(v)?.group !== group)
  emit('update:modelValue', id ? [...rest, id] : rest)
}
</script>

<style scoped>
.cine { border: 0; padding: 0; margin: 0; min-width: 0; }
.cine-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; margin-top: 8px; }
.cine-group { display: grid; gap: 4px; min-width: 0; align-content: start; }
.cine-group-label { font-size: 13px; font-weight: 600; opacity: .85; }
.cine-desc { font-size: 12px; opacity: .75; line-height: 1.45; }
.cine-error { color: var(--danger, #c0392b); }
.cine-clear { margin-top: 10px; }
</style>
