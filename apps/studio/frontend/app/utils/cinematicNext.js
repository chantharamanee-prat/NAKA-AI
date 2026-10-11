// Cinematic techniques picked on the skills library's เทคนิคภาพยนตร์ shelf, waiting for the next product video
// (its create dialog starts from them). Kept for this browser tab only; one per group like the picker.
const KEY = 'naka_cinematic_next'

export function nextCinematic() {
  try { const v = JSON.parse(sessionStorage.getItem(KEY) || '[]'); return Array.isArray(v) ? v.filter(x => typeof x === 'string') : [] }
  catch { return [] }
}
/** add a technique, replacing any earlier pick of the same group (ids are '<group>.<name>') */
export function pickNextCinematic(id) {
  const group = String(id).split('.')[0]
  const next = [...nextCinematic().filter(x => x.split('.')[0] !== group), id]
  try { sessionStorage.setItem(KEY, JSON.stringify(next)) } catch { /* this visit only */ }
  return next
}
export function unpickNextCinematic(id) {
  const next = nextCinematic().filter(x => x !== id)
  try { sessionStorage.setItem(KEY, JSON.stringify(next)) } catch { /* this visit only */ }
  return next
}
export function clearNextCinematic() {
  try { sessionStorage.removeItem(KEY) } catch { /* nothing kept */ }
}
