// The cinematic techniques catalogue (GET /api/v1/cinematic-techniques, backend core/generation/cinematic-techniques.ts),
// fetched once and shared by the pickers and the skills library shelf: groups, the 150 techniques and the mood presets.
import { ref } from 'vue'
import { api } from '~/composables/useApi'

const groups = ref([])
const techniques = ref([])
const presets = ref([])
const error = ref('')
let loading = null

export function useCinematicTechniques() {
  function load() {
    if (techniques.value.length) return Promise.resolve()
    if (!loading) {
      loading = api.get('/cinematic-techniques')
        .then((data) => {
          groups.value = data.groups || []; techniques.value = data.techniques || []; presets.value = data.presets || []; error.value = ''
        })
        .catch(() => { error.value = 'load'; loading = null })
    }
    return loading
  }
  return { groups, techniques, presets, error, load }
}
