<template>
  <div class="sl">
    <!-- ===== Hero ===== -->
    <section class="sl-hero">
      <MenuHeroArt :src="menuArt('hero-skills')" />
      <p class="sl-kicker">
        <Sparkles :size="13" :stroke-width="2" />
        {{ t('productStudio.library.kicker') }}
      </p>
      <h1 class="sl-title">{{ t('productStudio.library.title') }}</h1>
      <p class="sl-sub">{{ t('productStudio.library.subtitle') }}</p>
      <label class="sl-search">
        <Search :size="16" :stroke-width="2" aria-hidden="true" />
        <input v-model="query" type="search" :placeholder="t('productStudio.library.searchPlaceholder')" :aria-label="t('productStudio.library.searchPlaceholder')" />
        <button v-if="query" type="button" class="sl-search-clear" :aria-label="t('productStudio.library.clearSearch')" @click="query = ''">
          <X :size="14" :stroke-width="2" />
        </button>
      </label>
    </section>

    <!-- ===== Category chips ===== -->
    <div class="sl-chips" role="group" :aria-label="t('productStudio.library.categoriesAria')">
      <button
        v-for="c in chips" :key="c.id" type="button"
        :class="['sl-chip', { on: category === c.id }]" :aria-pressed="category === c.id"
        @click="category = c.id"
      >
        <component :is="c.icon" :size="13" :stroke-width="2" />
        {{ c.label }}
        <span class="sl-chip-count">{{ c.count }}</span>
      </button>
    </div>

    <!-- ===== Featured: NAKA workflows ===== -->
    <section v-if="filteredWorkflows.length" class="sl-section">
      <div class="sl-section-head">
        <h2 class="sl-section-title">{{ t('productStudio.library.featuredTitle') }}</h2>
        <p class="sl-section-desc">{{ t('productStudio.library.featuredDesc') }}</p>
      </div>
      <div class="sl-grid sl-grid-wide">
        <StudioSkillCard
          v-for="(w, i) in filteredWorkflows" :key="w.id" wide
          :title="w.title" :description="w.description" :art="w.art" :icon="w.icon" :tint="w.tint"
          :badge="t('productStudio.library.badgeWorkflow')" :tags="w.tags"
          :style="{ animationDelay: `${Math.min(i, 8) * 0.03}s` }"
          @use="useWorkflow(w)"
        />
      </div>
    </section>

    <!-- ===== Product video skills (templates) ===== -->
    <section v-if="filteredTemplates.length" class="sl-section">
      <div class="sl-section-head">
        <h2 class="sl-section-title">{{ t('productStudio.library.productTitle') }}</h2>
        <p class="sl-section-desc">{{ t('productStudio.library.productDesc') }}</p>
      </div>
      <div class="sl-grid">
        <StudioSkillCard
          v-for="(tpl, i) in filteredTemplates" :key="tpl.id"
          :title="templateTitle(tpl)" :description="templateDesc(tpl)"
          :art="templateArt(tpl.id)" :art-index="templates.indexOf(tpl)" :icon="ShoppingBag"
          :badge="categoryLabel(tpl.category)" :duration="t('productStudio.templates.seconds', { n: totalSeconds(tpl) })"
          :tags="templateTags(tpl)"
          :style="{ animationDelay: `${Math.min(i, 8) * 0.03}s` }"
          @use="emit('use-template', tpl)"
        />
      </div>
    </section>

    <!-- ===== Cinematic techniques (150, core/generation/cinematic-techniques.ts) ===== -->
    <section v-if="showCinematic && filteredTechniques.length" class="sl-section" aria-labelledby="sl-cine-title">
      <div class="sl-section-head">
        <h2 id="sl-cine-title" class="sl-section-title">{{ t('components.cinematic.shelf') }} <span class="sl-count">{{ filteredTechniques.length }}</span></h2>
        <p class="sl-section-desc">{{ t('components.cinematic.shelfHint') }}</p>
      </div>
      <div class="sl-chips sl-subchips" role="group" :aria-label="t('components.cinematic.title')">
        <button type="button" :class="['sl-chip', { on: cineGroup === '' }]" :aria-pressed="cineGroup === ''" @click="cineGroup = ''">
          {{ t('productStudio.library.all') }}
        </button>
        <button v-for="g in cineGroups" :key="g.id" type="button" :class="['sl-chip', { on: cineGroup === g.id }]"
          :aria-pressed="cineGroup === g.id" @click="cineGroup = g.id">
          {{ th ? g.nameTh : g.name }}
        </button>
      </div>
      <p v-if="nextPicks.length" class="sl-next" role="status">
        <span>{{ t('components.cinematic.pending', { n: nextPicks.length }) }}</span>
        <button type="button" class="btn btn-sm" @click="emit('new-video')">{{ t('productStudio.create.title') }}</button>
      </p>
      <ul class="sl-cine-grid">
        <li v-for="x in filteredTechniques" :key="x.id" :class="['sl-cine', { on: nextPicks.includes(x.id) }]">
          <button v-if="!artFailed[x.id]" type="button" class="sl-cine-art"
            :aria-label="t('components.cinematic.view', { name: th ? x.nameTh : x.name })" @click="openView(x)">
            <img :src="cinematicArt(x.id)" alt="" loading="lazy" decoding="async" width="480" height="274" @error="artFailed[x.id] = true">
            <span v-if="isStrip(x)" class="sl-cine-strip">{{ t('components.cinematic.strip') }}</span>
          </button>
          <span class="sl-cine-group">{{ groupLabel(x.group) }}</span>
          <b class="sl-cine-name">{{ th ? x.nameTh : x.name }}</b>
          <span class="sl-cine-alt">{{ th ? x.name : x.nameTh }}</span>
          <p class="sl-cine-desc">{{ th ? x.descriptionTh : x.description }}</p>
          <button type="button" class="btn btn-sm" :aria-pressed="nextPicks.includes(x.id)" @click="toggleNext(x.id)">
            {{ nextPicks.includes(x.id) ? t('components.cinematic.used') : t('components.cinematic.use') }}
          </button>
        </li>
      </ul>
      <!-- the example image, large: click a card's image; Esc, the close button or the backdrop closes it -->
      <dialog ref="viewDialog" class="sl-cine-view" aria-labelledby="sl-cine-view-title" @close="viewing = null" @click.self="closeView">
        <div v-if="viewing" class="sl-cine-view-body">
          <img :src="cinematicArt(viewing.id)" :alt="th ? viewing.nameTh : viewing.name" width="1344" height="768">
          <span class="sl-cine-group">{{ groupLabel(viewing.group) }}</span>
          <h3 id="sl-cine-view-title" class="sl-cine-view-title">{{ th ? viewing.nameTh : viewing.name }}</h3>
          <span class="sl-cine-alt">{{ th ? viewing.name : viewing.nameTh }}</span>
          <p class="sl-cine-desc">{{ th ? viewing.descriptionTh : viewing.description }}</p>
          <p v-if="isStrip(viewing)" class="sl-cine-note">{{ t('components.cinematic.stripHint') }}</p>
          <div class="sl-cine-view-actions">
            <button type="button" class="btn btn-ghost" @click="closeView">{{ t('common.close') }}</button>
            <button type="button" class="btn btn-primary" :aria-pressed="nextPicks.includes(viewing.id)" @click="toggleNext(viewing.id)">
              {{ nextPicks.includes(viewing.id) ? t('components.cinematic.used') : t('components.cinematic.use') }}
            </button>
          </div>
        </div>
      </dialog>
    </section>

    <div v-if="loading && !templates.length" class="sl-grid" aria-hidden="true">
      <div v-for="i in 4" :key="i" class="sl-skeleton"></div>
    </div>

    <div v-else-if="!filteredWorkflows.length && !filteredTemplates.length && !(showCinematic && filteredTechniques.length)" class="sl-empty">
      <SearchX :size="26" :stroke-width="1.5" />
      <p class="sl-empty-title">{{ t('productStudio.library.emptyTitle') }}</p>
      <p class="sl-empty-desc">{{ t('productStudio.library.emptyDesc') }}</p>
      <button type="button" class="btn" @click="query = ''; category = 'all'">{{ t('productStudio.library.reset') }}</button>
    </div>
  </div>
</template>

<script setup>
import { Clapperboard, Copy, Eye, Heart, LayoutGrid, Lightbulb, Megaphone, Radio, Search, SearchX, Shirt, ShoppingBag, Sparkles, Store, UserRound, Workflow, X, Zap } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'
import { cinematicArt, menuArt, templateArt } from '~/utils/studioArt'
import MenuHeroArt from '~/components/MenuHeroArt.vue'
import { beatBars } from '../utils/studioFlow'
import { useCinematicTechniques } from '~/composables/useCinematicTechniques'
import { nextCinematic, pickNextCinematic, unpickNextCinematic } from '~/utils/cinematicNext'

/**
 * StudioSkillsLibrary — หน้า "คลังสกิล" (แนว Skills Library): hero + ค้นหา + ชิปหมวด
 * + แถว workflow ของ NAKA (ไปยังโมดูลอื่น) + การ์ดสกิลวิดีโอสินค้า (= เทมเพลต Product Studio)
 * เลือกสกิลเทมเพลต → emit use-template ให้หน้าแม่พาไป AI นักขาย (สร้างโพสต์ + ทำวิดีโอด้วยสกิลนั้น)
 */
const props = defineProps({
  templates: { type: Array, default: () => [] },
  loading: { type: Boolean, default: false },
})
const emit = defineEmits(['use-template', 'go-tab', 'new-video'])
const { t, te, locale } = useI18n()

// ----- cinematic techniques shelf: pick techniques for the next product video (its create dialog starts from them)
const { groups: cineGroups, techniques, load: loadTechniques } = useCinematicTechniques()
onMounted(loadTechniques)
const th = computed(() => String(locale.value).startsWith('th'))
const cineGroup = ref('')
const nextPicks = ref(nextCinematic())
const groupLabel = id => { const g = cineGroups.value.find(x => x.id === id); return g ? (th.value ? g.nameTh : g.name) : id }
function toggleNext(id) { nextPicks.value = nextPicks.value.includes(id) ? unpickNextCinematic(id) : pickNextCinematic(id) }
// example images (public/studio-art/cinematic): a card whose image is missing keeps its text-only layout
const artFailed = reactive({})
// camera movement and timing cannot show in one still: their example is a strip of three frames
const isStrip = x => cineGroups.value.find(g => g.id === x.group)?.image === false
const viewing = ref(null)
const viewDialog = ref(null)
function openView(x) { viewing.value = x; viewDialog.value?.showModal() }
function closeView() { viewDialog.value?.close() }

const query = ref('')
// ?shelf=cinematic opens the cinematic techniques (the shortcut in Settings → skill library → camera angles)
const category = ref(useRoute().query.shelf === 'cinematic' ? 'cinematic' : 'all')

const CATEGORY_ICONS = { review: Heart, demo: Lightbulb, fashion_beauty: Shirt, showcase: Eye, promo: Zap }

// workflow ของแต่ละโมดูลใน NAKA — route = ไปหน้าอื่น, tab = สลับแท็บในหน้านี้
const workflows = computed(() => [
  { id: 'seller', route: '/seller', icon: Store, tint: '#ee4d2d', art: menuArt('wf-seller') },
  { id: 'drama', route: '/drama', icon: Clapperboard, tint: '#8b5cf6', art: menuArt('wf-drama') },
  { id: 'marketer', route: '/marketer', icon: Megaphone, tint: '#f97316', art: menuArt('wf-marketer') },
  { id: 'viralClone', route: '/viral-clone', icon: Copy, tint: '#ec4899', art: menuArt('wf-viral-clone') },
  { id: 'live', route: '/live', icon: Radio, tint: '#ef4444', art: menuArt('wf-live') },
  { id: 'avatar', tab: 'avatars', icon: UserRound, tint: '#0ea5e9', art: menuArt('wf-avatar') },
  { id: 'influencer', tab: 'influencers', icon: Sparkles, tint: '#22c55e', art: menuArt('wf-influencer') },
].map(w => ({
  ...w,
  art: w.art ? [w.art] : [],
  title: t(`productStudio.library.workflows.${w.id}.name`),
  description: t(`productStudio.library.workflows.${w.id}.description`),
  tags: [t(`productStudio.library.workflows.${w.id}.tag`)],
})))

const templateCategories = computed(() => [...new Set(props.templates.map(tpl => tpl.category).filter(Boolean))])

function categoryLabel(c) {
  const key = `productStudio.categories.${c}`
  return te(key) ? t(key) : c
}
const templateTitle = tpl => t(`productStudio.templates.${tpl.id}.name`)
const templateDesc = tpl => t(`productStudio.templates.${tpl.id}.description`)
const totalSeconds = tpl => beatBars(tpl).reduce((s, b) => s + b.seconds, 0)
function templateTags(tpl) {
  const tags = []
  if (tpl.avatarMode === 'required') tags.push(t('productStudio.library.tagAvatar'))
  else if (tpl.avatarMode === 'hands') tags.push(t('productStudio.library.tagHands'))
  tags.push(tpl.hasDialogue ? t('productStudio.library.tagVoice') : t('productStudio.library.tagNoVoice'))
  return tags
}

const q = computed(() => query.value.trim().toLowerCase())
const matches = (...texts) => !q.value || texts.some(s => String(s || '').toLowerCase().includes(q.value))

const searchedWorkflows = computed(() => workflows.value.filter(w => matches(w.title, w.description, ...w.tags)))
const searchedTemplates = computed(() => props.templates.filter(tpl =>
  matches(templateTitle(tpl), templateDesc(tpl), categoryLabel(tpl.category), ...templateTags(tpl))))

const filteredWorkflows = computed(() => (category.value === 'all' || category.value === 'workflow') ? searchedWorkflows.value : [])
const filteredTemplates = computed(() => {
  if (category.value === 'workflow') return []
  if (category.value === 'all') return searchedTemplates.value
  return searchedTemplates.value.filter(tpl => tpl.category === category.value)
})

const searchedTechniques = computed(() => techniques.value.filter(x =>
  matches(x.name, x.nameTh, x.description, x.descriptionTh, groupLabel(x.group))))
const filteredTechniques = computed(() => searchedTechniques.value.filter(x => !cineGroup.value || x.group === cineGroup.value))
// the techniques shelf shows under "all" only while searching (150 cards would bury the templates), and on its own chip
const showCinematic = computed(() => category.value === 'cinematic' || (category.value === 'all' && !!q.value))

const chips = computed(() => [
  { id: 'all', label: t('productStudio.library.all'), icon: LayoutGrid, count: searchedWorkflows.value.length + searchedTemplates.value.length },
  { id: 'workflow', label: t('productStudio.library.workflowChip'), icon: Workflow, count: searchedWorkflows.value.length },
  { id: 'cinematic', label: t('components.cinematic.shelf'), icon: Clapperboard, count: searchedTechniques.value.length },
  ...templateCategories.value.map(c => ({
    id: c, label: categoryLabel(c), icon: CATEGORY_ICONS[c] || ShoppingBag,
    count: searchedTemplates.value.filter(tpl => tpl.category === c).length,
  })),
])

function useWorkflow(w) {
  if (w.tab) emit('go-tab', w.tab)
  else navigateTo(w.route)
}
</script>

<style scoped>
.sl { display: flex; flex-direction: column; gap: 22px; }

/* === Hero === */
.sl-hero {
  position: relative; overflow: hidden; isolation: isolate;
  display: flex; flex-direction: column; align-items: flex-start; text-align: left; gap: 10px;
  min-height: 300px; justify-content: center;
  padding: 44px 40px 36px;
  border-radius: var(--radius-xl); border: 1px solid var(--border);
  background:
    radial-gradient(ellipse at 15% 0%, color-mix(in srgb, var(--accent) 22%, transparent), transparent 55%),
    radial-gradient(ellipse at 90% 100%, color-mix(in srgb, #8b5cf6 18%, transparent), transparent 55%),
    var(--surface-soft);
}
.sl-kicker {
  display: inline-flex; align-items: center; gap: 6px; margin: 0;
  padding: 4px 12px; border-radius: 999px;
  font-size: 11.5px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase;
  background: var(--accent-bg); color: var(--accent-text);
}
.sl-title {
  margin: 0;
  font-family: var(--font-display); font-size: clamp(28px, 4.5vw, 44px); font-weight: 800;
  letter-spacing: -0.02em; line-height: 1.15;
  background: var(--accent-gradient); -webkit-background-clip: text; background-clip: text; color: transparent;
}
.sl-sub { margin: 0; max-width: 560px; font-size: 14px; line-height: 1.6; color: var(--text-2); }
.sl-search {
  display: flex; align-items: center; gap: 8px;
  width: min(520px, 100%); height: 46px; margin-top: 8px; padding: 0 8px 0 16px;
  border-radius: 999px; border: 1px solid var(--border);
  background: var(--surface-raised); color: var(--text-3);
  box-shadow: var(--shadow-sm, none);
  transition: border-color 0.15s var(--ease-out), box-shadow 0.15s var(--ease-out);
}
.sl-search:focus-within { border-color: var(--accent); box-shadow: 0 0 0 3px var(--button-focus); }
.sl-search input {
  flex: 1; min-width: 0; height: 100%;
  border: none; outline: none; background: transparent;
  font: 500 14px var(--font-body); color: var(--text-0);
}
.sl-search input::placeholder { color: var(--text-3); }
.sl-search input::-webkit-search-cancel-button { display: none; }
.sl-search-clear {
  display: flex; align-items: center; justify-content: center;
  width: 30px; height: 30px; border: none; border-radius: 50%;
  background: transparent; color: var(--text-3); cursor: pointer;
}
.sl-search-clear:hover { background: var(--bg-hover); color: var(--text-0); }

/* === Chips === */
.sl-chips { display: flex; gap: 8px; overflow-x: auto; padding: 2px; scrollbar-width: none; }
.sl-chips::-webkit-scrollbar { display: none; }
.sl-chip {
  display: inline-flex; align-items: center; gap: 6px; flex-shrink: 0;
  height: 36px; padding: 0 14px; border-radius: 999px;
  border: 1px solid var(--border); background: var(--surface-raised);
  font: 600 13px var(--font-body); color: var(--text-1); cursor: pointer;
  transition: border-color 0.15s var(--ease-out), background 0.15s var(--ease-out), color 0.15s var(--ease-out);
}
.sl-chip:hover { border-color: var(--border-strong); color: var(--text-0); }
.sl-chip:focus-visible { outline: none; box-shadow: 0 0 0 3px var(--button-focus); }
.sl-chip.on { border-color: transparent; background: var(--text-0); color: var(--bg-base); }
.sl-chip-count {
  min-width: 20px; padding: 0 6px; border-radius: 999px;
  font-size: 11px; line-height: 18px; text-align: center;
  background: var(--bg-hover); color: var(--text-2);
}
.sl-chip.on .sl-chip-count { background: color-mix(in srgb, var(--bg-base) 22%, transparent); color: var(--bg-base); }

/* === Sections === */
.sl-section { display: flex; flex-direction: column; gap: 14px; }
.sl-section-head { display: flex; flex-direction: column; gap: 2px; }
.sl-section-title { margin: 0; font-family: var(--font-display); font-size: 19px; font-weight: 800; color: var(--text-0); }
.sl-section-desc { margin: 0; font-size: 12.5px; color: var(--text-2); }
.sl-grid {
  display: grid; gap: 22px 16px;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
}
.sl-grid-wide { grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); }
.sl-skeleton {
  aspect-ratio: 3 / 4; border-radius: var(--radius-xl);
  background: var(--bg-hover);
  animation: sl-pulse 1.4s ease-in-out infinite;
}
@keyframes sl-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }

/* === Cinematic techniques shelf === */
.sl-count { margin-left: 6px; font-size: 13px; font-weight: 700; color: var(--text-3); }
.sl-subchips { margin-top: -4px; }
.sl-next {
  position: sticky; top: 8px; z-index: 2;
  display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap;
  margin: 0; padding: 10px 14px; border-radius: var(--radius-lg);
  border: 1px solid var(--accent); background: var(--surface-raised); color: var(--text-0); font-size: 13px; font-weight: 600;
  box-shadow: var(--shadow-sm, 0 4px 14px rgba(0, 0, 0, .18));
}
.sl-cine-grid { display: grid; gap: 12px; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); margin: 0; padding: 0; list-style: none; }
.sl-cine {
  display: flex; flex-direction: column; gap: 4px; min-width: 0;
  padding: 14px; border-radius: var(--radius-lg); border: 1px solid var(--border); background: var(--surface-raised);
}
.sl-cine.on { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
.sl-cine-group { align-self: flex-start; padding: 1px 8px; border-radius: 999px; font-size: 11px; font-weight: 700; background: var(--bg-hover); color: var(--text-2); }
.sl-cine-name { font-size: 15px; color: var(--text-0); }
.sl-cine-alt { font-size: 12px; color: var(--text-3); }
.sl-cine-desc { flex: 1; margin: 4px 0 8px; font-size: 12.5px; line-height: 1.5; color: var(--text-2); }
.sl-cine .btn { align-self: flex-start; min-height: 40px; }
.sl-cine-art {
  position: relative; display: block; margin: -14px -14px 6px; padding: 0; border: 0; cursor: zoom-in;
  aspect-ratio: 480 / 274; overflow: hidden; border-radius: var(--radius-lg) var(--radius-lg) 0 0; background: var(--bg-hover);
}
.sl-cine-art img { display: block; width: 100%; height: 100%; object-fit: cover; transition: transform .25s ease; }
.sl-cine-art:hover img, .sl-cine-art:focus-visible img { transform: scale(1.04); }
.sl-cine-art:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
.sl-cine-strip {
  position: absolute; right: 8px; bottom: 8px; padding: 2px 8px; border-radius: 999px;
  font-size: 11px; font-weight: 700; background: rgba(0, 0, 0, .66); color: #fff;
}
.sl-cine-view {
  position: fixed; inset: 0; margin: auto; height: fit-content;
  width: min(880px, calc(100vw - 32px)); max-height: calc(100dvh - 32px); padding: 0; overflow: auto;
  border: 1px solid var(--border); border-radius: var(--radius-xl); background: var(--surface-raised); color: var(--text-1);
}
.sl-cine-view::backdrop { background: rgba(0, 0, 0, .6); }
.sl-cine-view-body { display: flex; flex-direction: column; gap: 4px; padding: 0 20px 20px; }
.sl-cine-view-body > img { display: block; width: calc(100% + 40px); height: auto; margin: 0 -20px 12px; background: var(--bg-hover); }
.sl-cine-view-title { margin: 4px 0 0; font-size: 20px; color: var(--text-0); }
.sl-cine-note { margin: 0 0 8px; font-size: 12.5px; color: var(--text-3); }
.sl-cine-view-actions { display: flex; justify-content: flex-end; gap: 8px; flex-wrap: wrap; margin-top: 8px; }
.sl-cine-view-actions .btn { min-height: 44px; }

/* === Empty === */
.sl-empty {
  display: flex; flex-direction: column; align-items: center; gap: 6px;
  padding: 56px 24px; border: 1px dashed var(--border); border-radius: var(--radius-lg);
  color: var(--text-3); text-align: center;
}
.sl-empty-title { margin: 8px 0 0; font-size: 15px; font-weight: 700; color: var(--text-1); }
.sl-empty-desc { margin: 0 0 12px; font-size: 12.5px; }

@media (max-width: 860px) {
  .sl-hero { padding: 32px 16px 26px; }
  .sl-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px 12px; }
  .sl-grid-wide { grid-template-columns: 1fr; }
}
</style>
