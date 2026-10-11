// The cinematic techniques catalogue (GET /api/v1/cinematic-techniques, backend core/generation/cinematic-techniques.ts),
// fetched once and shared by the pickers and the skills library shelf.
import { ref } from 'vue'
import { api } from '~/composables/useApi'

const groups = ref([])
const techniques = ref([])
const error = ref('')
let loading = null

export function useCinematicTechniques() {
  function load() {
    if (techniques.value.length) return Promise.resolve()
    if (!loading) {
      loading = api.get('/cinematic-techniques')
        .then((data) => { groups.value = data.groups || []; techniques.value = data.techniques || []; error.value = '' })
        .catch(() => { error.value = 'load'; loading = null })
    }
    return loading
  }
  return { groups, techniques, error, load }
}
