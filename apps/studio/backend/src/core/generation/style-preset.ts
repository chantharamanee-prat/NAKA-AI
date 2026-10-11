/**
 * 风格预设服务 — 将项目绑定的视觉风格解析为英文提示词片段
 * dramas.style 存 style_presets.value；查不到/已停用时返回空串（调用方走兜底）
 */
import { and, eq } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { cinematicPrompt } from './cinematic-techniques.js'

/** style value of a drama whose look the author typed in (drama page → Art Style → Custom) */
export const CUSTOM_STYLE = 'custom'
/** longest custom style description kept (it is prepended to every image and video prompt) */
export const CUSTOM_STYLE_MAX = 600

/** The custom style text saved in a drama's metadata (metadata.customStyle), trimmed and capped; '' when none. */
export function customStyleOf(metadata: unknown): string {
  let meta: any = metadata
  if (typeof meta === 'string') {
    try { meta = JSON.parse(meta) } catch { return '' }
  }
  const text = typeof meta?.customStyle === 'string' ? meta.customStyle.trim() : ''
  return text.slice(0, CUSTOM_STYLE_MAX)
}

/** 查询项目绑定的风格预设英文提示词片段；查不到返回 ''（custom：作者自己写的风格描述） */
export async function getDramaStylePrompt(dramaId: number | null | undefined): Promise<string> {
  if (!dramaId) return ''
  const [drama] = await db.select().from(schema.dramas).where(eq(schema.dramas.id, dramaId))
  if (!drama?.style) return ''
  if (drama.style === CUSTOM_STYLE) return customStyleOf(drama.metadata)
  const [preset] = await db.select().from(schema.stylePresets)
    .where(and(eq(schema.stylePresets.value, drama.style), eq(schema.stylePresets.isActive, true)))
  return preset?.prompt || ''
}

/**
 * The cinematic techniques picked for a drama (cinematic-techniques.ts), as the "Cinematography:" line for a shot's
 * image or video prompt. A drama keeps its picks in metadata.cinematic; a product video's hidden drama
 * (metadata.studioProjectId) uses its project's studio_projects.cinematic. '' when nothing is picked.
 */
export async function getDramaCinematicPrompt(dramaId: number | null | undefined, kind: 'image' | 'video'): Promise<string> {
  if (!dramaId) return ''
  const [drama] = await db.select({ metadata: schema.dramas.metadata }).from(schema.dramas).where(eq(schema.dramas.id, dramaId))
  let meta: any = null
  try { meta = drama?.metadata ? JSON.parse(drama.metadata) : null } catch { /* not JSON: nothing picked */ }
  let picks: unknown = meta?.cinematic
  if (!Array.isArray(picks) && Number.isInteger(meta?.studioProjectId)) {
    const [project] = await db.select({ cinematic: schema.studioProjects.cinematic }).from(schema.studioProjects)
      .where(eq(schema.studioProjects.id, meta.studioProjectId))
    try { picks = project?.cinematic ? JSON.parse(project.cinematic) : null } catch { picks = null }
  }
  return cinematicPrompt(picks, kind)
}

/** The drama a storyboard (shot) belongs to, through its episode; null when it has none. */
export async function dramaIdOfStoryboard(storyboardId: number | null | undefined): Promise<number | null> {
  if (!storyboardId) return null
  const [row] = await db.select({ dramaId: schema.episodes.dramaId }).from(schema.storyboards)
    .innerJoin(schema.episodes, eq(schema.episodes.id, schema.storyboards.episodeId))
    .where(eq(schema.storyboards.id, storyboardId))
  return row?.dramaId ?? null
}
