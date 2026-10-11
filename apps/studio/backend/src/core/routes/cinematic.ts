/**
 * GET /api/v1/cinematic-techniques: the 150 cinematic techniques and their groups (core/generation/cinematic-techniques.ts),
 * for the pickers on the product-video and drama pages and the "เทคนิคภาพยนตร์" shelf of the skills library.
 * Read only and the same for everyone.
 */
import { Hono } from 'hono'
import { success } from '../http/response.js'
import { CINEMATIC_GROUPS, CINEMATIC_TECHNIQUES } from '../generation/cinematic-techniques.js'

const app = new Hono()
app.get('/', (c) => success(c, { groups: CINEMATIC_GROUPS, techniques: CINEMATIC_TECHNIQUES }))
export default app
