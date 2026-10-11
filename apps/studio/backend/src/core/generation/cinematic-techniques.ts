/**
 * Cinematic techniques: 150 film and photography techniques a member can pick when making a video (product videos and
 * short dramas). The names are the industry's standard vocabulary; every description and prompt here is written for
 * NAKA-AI, not copied from any other library (studio-templates.ts has the same rule).
 *
 * A member picks at most one technique per group. The picks become one "Cinematography:" line in the image and video
 * prompts (cinematicPrompt); camera movement only reaches video prompts, because a still image cannot move.
 */

export type CinematicGroup = 'shot' | 'movement' | 'lighting' | 'composition' | 'lens' | 'look' | 'pacing'

export interface CinematicTechnique {
  id: string
  group: CinematicGroup
  name: string
  nameTh: string
  description: string
  descriptionTh: string
  /** the words given to the image/video model */
  prompt: string
}

export const CINEMATIC_GROUPS: { id: CinematicGroup; name: string; nameTh: string; video: boolean; image: boolean }[] = [
  { id: 'shot', name: 'Shot size & angle', nameTh: 'ขนาดภาพและมุมกล้อง', video: true, image: true },
  { id: 'movement', name: 'Camera movement', nameTh: 'การเคลื่อนกล้อง', video: true, image: false },
  { id: 'lighting', name: 'Lighting', nameTh: 'แสง', video: true, image: true },
  { id: 'composition', name: 'Composition', nameTh: 'องค์ประกอบภาพ', video: true, image: true },
  { id: 'lens', name: 'Lens & focus', nameTh: 'เลนส์และโฟกัส', video: true, image: true },
  { id: 'look', name: 'Color & film look', nameTh: 'โทนสีและลุคฟิล์ม', video: true, image: true },
  { id: 'pacing', name: 'Motion & timing', nameTh: 'จังหวะและการเคลื่อนไหว', video: true, image: false },
]

type Row = [id: string, name: string, nameTh: string, description: string, descriptionTh: string, prompt: string]
const rows = (group: CinematicGroup, list: Row[]): CinematicTechnique[] =>
  list.map(([id, name, nameTh, description, descriptionTh, prompt]) => ({ id: `${group}.${id}`, group, name, nameTh, description, descriptionTh, prompt }))

export const CINEMATIC_TECHNIQUES: CinematicTechnique[] = [
  ...rows('shot', [
    ['extreme-wide', 'Extreme wide shot', 'ภาพกว้างมาก', 'The setting dominates and the subject is small within it.', 'ฉากใหญ่เด่น ตัวแบบเล็กอยู่ในฉาก เหมาะเปิดเรื่องหรือบอกสถานที่', 'extreme wide shot, subject small in a vast setting'],
    ['wide', 'Wide shot', 'ภาพกว้าง', 'Whole body with plenty of surroundings.', 'เห็นทั้งตัวและสภาพแวดล้อมรอบ ๆ', 'wide shot, full body with generous surroundings'],
    ['full', 'Full shot', 'ภาพเต็มตัว', 'Head to toe, framed close around the body.', 'เห็นตั้งแต่หัวจรดเท้า เหมาะโชว์ชุดหรือท่าทาง', 'full shot, head to toe framing'],
    ['medium-wide', 'Medium wide shot', 'ภาพกลางค่อนกว้าง', 'From the knees up, body language stays readable.', 'ตั้งแต่เข่าขึ้นไป เห็นภาษากายชัด', 'medium wide shot, framed from the knees up'],
    ['medium', 'Medium shot', 'ภาพระยะกลาง', 'From the waist up, the everyday conversational frame.', 'ตั้งแต่เอวขึ้นไป ใช้บ่อยในฉากพูดคุย', 'medium shot, waist up'],
    ['medium-close', 'Medium close-up', 'ภาพใกล้ระดับอก', 'Chest up, face and gestures together.', 'ตั้งแต่อกขึ้นไป เห็นทั้งสีหน้าและมือ', 'medium close-up, chest up'],
    ['close-up', 'Close-up', 'ภาพใกล้', 'The face fills the frame for emotion.', 'ใบหน้าเต็มเฟรม เน้นอารมณ์', 'close-up on the face, emotion in focus'],
    ['extreme-close', 'Extreme close-up', 'ภาพใกล้มาก', 'One detail fills the frame: an eye, a texture, a label.', 'รายละเอียดเดียวเต็มจอ เช่น ดวงตา ผิวสัมผัส ฉลากสินค้า', 'extreme close-up on a single detail, texture visible'],
    ['detail-insert', 'Product insert', 'ช็อตแทรกสินค้า', 'A tight cutaway that shows the product or an object clearly.', 'ช็อตแทรกสั้น ๆ ให้เห็นสินค้าหรือของชัดเจน', 'insert shot, the product sharp and centered, clean background'],
    ['two-shot', 'Two-shot', 'ช็อตสองคน', 'Two people share the frame to show their relationship.', 'สองคนอยู่ในเฟรมเดียว เห็นความสัมพันธ์', 'two-shot, both characters in frame'],
    ['over-shoulder', 'Over the shoulder', 'มุมข้ามไหล่', 'Seen past one person toward the other in a conversation.', 'มองผ่านไหล่คนหนึ่งไปหาอีกคน ใช้ในบทสนทนา', 'over-the-shoulder shot, foreground shoulder soft'],
    ['pov', 'Point of view', 'มุมมองตัวละคร', 'The camera sees what the character sees.', 'กล้องเห็นแบบเดียวกับที่ตัวละครเห็น', 'first-person point of view shot'],
    ['eye-level', 'Eye level', 'ระดับสายตา', 'Neutral and honest, at the subject eye height.', 'กล้องอยู่ระดับสายตา ดูเป็นกลางและจริงใจ', 'eye-level camera, neutral perspective'],
    ['low-angle', 'Low angle', 'มุมต่ำ', 'Looking up makes the subject strong or impressive.', 'มองขึ้น ทำให้ตัวแบบดูมีพลังหรือยิ่งใหญ่', 'low-angle shot looking up, subject appears powerful'],
    ['high-angle', 'High angle', 'มุมสูง', 'Looking down makes the subject smaller or vulnerable.', 'มองลง ทำให้ตัวแบบดูเล็กหรือเปราะบาง', 'high-angle shot looking down'],
    ['top-down', 'Top-down flat lay', 'มุมบนลงล่าง', 'Straight down onto a table, ideal for products and food.', 'ถ่ายตรงลงจากด้านบน เหมาะกับสินค้าและอาหาร', 'top-down overhead shot, flat lay arrangement'],
    ['birds-eye', "Bird's eye view", 'มุมนก', 'Very high above, people and places become patterns.', 'สูงมากจากด้านบน คนและสถานที่กลายเป็นลวดลาย', "bird's-eye view from high above"],
    ['worms-eye', "Worm's eye view", 'มุมหนอน', 'From the ground looking steeply up.', 'จากพื้นมองขึ้นชัน ๆ ให้ความยิ่งใหญ่', "worm's-eye view from ground level looking up"],
    ['dutch', 'Dutch angle', 'มุมเอียง', 'A tilted horizon for unease or energy.', 'เอียงเส้นขอบฟ้า ให้ความรู้สึกไม่มั่นคงหรือตื่นเต้น', 'Dutch angle, camera tilted about 20 degrees'],
    ['profile', 'Profile shot', 'ช็อตด้านข้าง', 'The subject seen side-on.', 'เห็นตัวแบบจากด้านข้าง ดูนิ่งและมีสไตล์', 'profile shot, subject seen from the side'],
    ['frontal', 'Frontal symmetric', 'หน้าตรงสมมาตร', 'Straight on, the subject facing the lens.', 'หันตรงเข้ากล้อง ดูตั้งใจและชัดเจน', 'frontal shot, subject facing the camera directly'],
    ['establishing', 'Establishing shot', 'ช็อตบอกสถานที่', 'Shows where we are before the action starts.', 'บอกคนดูว่าเรื่องเกิดที่ไหน ก่อนเริ่มเหตุการณ์', 'establishing shot of the location'],
    ['reaction', 'Reaction shot', 'ช็อตปฏิกิริยา', 'A face responding to what just happened.', 'ใบหน้าที่ตอบสนองต่อเหตุการณ์ที่เพิ่งเกิด', 'reaction shot, expressive face responding'],
    ['hands', 'Hands at work', 'ช็อตมือ', 'Only the hands, using or holding something.', 'เห็นแค่มือที่กำลังใช้หรือถือของ เหมาะสาธิตสินค้า', 'close shot of hands using the product'],
    ['silhouette-frame', 'Silhouette shot', 'ช็อตเงาดำ', 'The subject as a dark shape against a bright background.', 'ตัวแบบเป็นเงาดำตัดกับฉากหลังสว่าง', 'silhouette against a bright background'],
  ]),
  ...rows('movement', [
    ['static', 'Locked-off static', 'กล้องนิ่ง', 'The camera does not move; the action does.', 'กล้องไม่ขยับ ปล่อยให้สิ่งในภาพเคลื่อนไหวเอง', 'static locked-off camera, no camera movement'],
    ['push-in', 'Slow push-in', 'ดันกล้องเข้าช้า ๆ', 'Moves gently closer to build focus or tension.', 'ค่อย ๆ เคลื่อนเข้าใกล้ เพิ่มความสนใจหรือความตึงเครียด', 'slow push-in toward the subject'],
    ['pull-out', 'Pull-out', 'ถอยกล้องออก', 'Moves away to reveal more of the scene.', 'ถอยออกเพื่อเผยให้เห็นฉากมากขึ้น', 'slow pull-out revealing the surroundings'],
    ['dolly-left', 'Lateral dolly', 'เลื่อนกล้องด้านข้าง', 'Glides sideways alongside the subject.', 'เลื่อนไปด้านข้างขนานกับตัวแบบ', 'smooth lateral dolly move alongside the subject'],
    ['tracking', 'Tracking shot', 'ตามติด', 'Follows a moving subject at a steady distance.', 'ตามตัวแบบที่กำลังเคลื่อนที่ในระยะคงที่', 'tracking shot following the subject at a steady distance'],
    ['lead', 'Leading shot', 'นำหน้าตัวแบบ', 'Moves backward in front of a walking subject.', 'กล้องถอยหลังนำหน้าคนที่เดินเข้ามา', 'leading shot, camera moving backward ahead of the subject'],
    ['orbit', 'Orbit', 'โคจรรอบตัวแบบ', 'Circles around the subject.', 'หมุนวนรอบตัวแบบ ให้ความรู้สึกพิเศษ', 'camera orbiting around the subject'],
    ['product-turn', '360 product orbit', 'หมุนรอบสินค้า 360', 'A full turn around a product to show every side.', 'หมุนรอบสินค้าครบรอบ ให้เห็นทุกด้าน', 'smooth 360-degree orbit around the product'],
    ['pan', 'Pan', 'แพนกล้อง', 'Turns horizontally from one point to another.', 'หมุนกล้องแนวนอนจากจุดหนึ่งไปอีกจุด', 'slow horizontal pan'],
    ['whip-pan', 'Whip pan', 'แพนเร็ว', 'A very fast pan that blurs, full of energy.', 'แพนเร็วจนภาพเบลอ ให้พลังและจังหวะ', 'fast whip pan with motion blur'],
    ['tilt-up', 'Tilt up', 'เงยกล้องขึ้น', 'Rises vertically to reveal height or a face.', 'เงยขึ้นเพื่อเผยความสูงหรือใบหน้า', 'slow tilt up revealing the subject'],
    ['tilt-down', 'Tilt down', 'ก้มกล้องลง', 'Descends vertically toward a detail.', 'ก้มลงหารายละเอียดด้านล่าง', 'slow tilt down to a detail'],
    ['crane-up', 'Crane up', 'เครนขึ้น', 'Rises high over the scene, often at an ending.', 'ยกกล้องขึ้นสูงเหนือฉาก มักใช้ตอนจบ', 'crane shot rising above the scene'],
    ['crane-down', 'Crane down', 'เครนลง', 'Descends from above into the scene.', 'ลดกล้องจากที่สูงลงมาเข้าฉาก', 'crane shot descending into the scene'],
    ['drone', 'Drone flyover', 'โดรนบินผ่าน', 'Sweeps over a landscape or city from the air.', 'บินผ่านทิวทัศน์หรือเมืองจากมุมสูง', 'aerial drone flyover, smooth and high'],
    ['handheld', 'Handheld', 'ถือกล้อง', 'Natural shake for realism and urgency.', 'ภาพสั่นเล็กน้อยแบบถือกล้อง ให้ความสมจริง', 'handheld camera with natural subtle shake'],
    ['steadicam', 'Steadicam float', 'กล้องลอยนิ่ง', 'Smooth floating movement through a space.', 'เคลื่อนผ่านพื้นที่อย่างลื่นไหลเหมือนลอย', 'smooth steadicam glide through the space'],
    ['dolly-zoom', 'Dolly zoom', 'ดอลลี่ซูม', 'Background stretches while the subject stays the same size.', 'ฉากหลังยืดหรือหดขณะตัวแบบขนาดเท่าเดิม ให้ความรู้สึกช็อก', 'dolly zoom effect, background warping behind a steady subject'],
    ['crash-zoom', 'Crash zoom', 'ซูมกระแทก', 'A sudden fast zoom for emphasis or comedy.', 'ซูมเข้าเร็วทันที เน้นจังหวะหรือสร้างมุก', 'sudden fast crash zoom in'],
    ['slow-zoom', 'Slow zoom', 'ซูมช้า', 'A gentle optical zoom for a calm build.', 'ซูมเข้าอย่างนุ่มนวล ค่อย ๆ ดึงความสนใจ', 'slow gentle zoom in'],
    ['arc-reveal', 'Arc reveal', 'โค้งเผยตัว', 'Curves around an obstacle to reveal the subject.', 'โค้งผ่านสิ่งบังเพื่อเผยตัวแบบ', 'camera arcs around a foreground object to reveal the subject'],
    ['rise-reveal', 'Rise reveal', 'ยกขึ้นเผยตัว', 'Lifts over a foreground edge to reveal what is behind.', 'ยกกล้องข้ามขอบด้านหน้าเพื่อเผยสิ่งที่อยู่หลัง', 'camera rises over a foreground edge to reveal the scene'],
    ['roll', 'Barrel roll', 'หมุนกล้องรอบแกน', 'Rotates around the lens axis for disorientation.', 'หมุนภาพรอบแกนเลนส์ ให้ความรู้สึกเวียนหัวหรือฝัน', 'camera barrel roll rotation'],
    ['fpv', 'FPV dive', 'โดรน FPV พุ่ง', 'Fast agile flight diving through spaces.', 'บินพุ่งผ่านช่องว่างอย่างเร็วและคล่องตัว', 'FPV drone diving fast through the scene'],
    ['macro-slide', 'Macro slide', 'เลื่อนมาโคร', 'A tiny slow slide across a close detail.', 'เลื่อนช้า ๆ ผ่านรายละเอียดระยะใกล้มาก', 'slow macro slider move across the detail'],
  ]),
  ...rows('lighting', [
    ['natural', 'Natural daylight', 'แสงธรรมชาติ', 'Soft, true-to-life daylight.', 'แสงกลางวันนุ่มและเป็นธรรมชาติ', 'natural soft daylight'],
    ['golden-hour', 'Golden hour', 'แสงทองยามเย็น', 'Warm low sun with long soft shadows.', 'แสงแดดอุ่นมุมต่ำ เงายาวนุ่ม', 'golden hour sunlight, warm and low'],
    ['blue-hour', 'Blue hour', 'แสงฟ้ายามโพล้เพล้', 'Cool even light just after sunset.', 'แสงเย็นสีฟ้าหลังพระอาทิตย์ตก', 'blue hour twilight, cool even light'],
    ['overcast', 'Overcast soft', 'ฟ้าครึ้ม', 'Shadowless cloudy light, flattering skin.', 'แสงเมฆครึ้ม ไร้เงาแข็ง ผิวดูดี', 'soft overcast light, no harsh shadows'],
    ['hard-sun', 'Hard midday sun', 'แดดแรงเที่ยงวัน', 'Strong sun with crisp, dark shadows.', 'แดดแรง เงาคมเข้ม ดูร้อนและชัด', 'hard midday sunlight, crisp dark shadows'],
    ['window', 'Window light', 'แสงจากหน้าต่าง', 'A soft side light from a nearby window.', 'แสงนุ่มด้านข้างจากหน้าต่าง ดูอบอุ่นในบ้าน', 'soft window light from the side'],
    ['three-point', 'Three-point lighting', 'ไฟสามจุด', 'Key, fill and back light; clean and balanced.', 'ไฟหลัก ไฟเสริม และไฟหลัง สะอาดและสมดุล', 'classic three-point lighting, balanced and clean'],
    ['high-key', 'High-key', 'โทนสว่าง', 'Bright and low-contrast, cheerful.', 'สว่างทั้งภาพ คอนทราสต์ต่ำ ดูสดใส', 'high-key lighting, bright and low contrast'],
    ['low-key', 'Low-key', 'โทนมืด', 'Mostly dark with deep shadows, dramatic.', 'มืดเป็นส่วนใหญ่ เงาเข้ม ดูดราม่า', 'low-key lighting, deep shadows, dramatic'],
    ['chiaroscuro', 'Chiaroscuro', 'แสงเงาตัดกันแรง', 'Strong light-dark contrast that sculpts the face.', 'แสงกับเงาตัดกันชัด ปั้นรูปหน้าให้มีมิติ', 'chiaroscuro lighting, strong contrast sculpting the face'],
    ['rembrandt', 'Rembrandt', 'แสงแรมแบรนต์', 'A small triangle of light on the shadowed cheek.', 'มีแสงรูปสามเหลี่ยมเล็ก ๆ บนแก้มด้านเงา', 'Rembrandt lighting with a triangle of light on the cheek'],
    ['butterfly', 'Butterfly', 'แสงผีเสื้อ', 'Light from above the lens, glamorous beauty look.', 'ไฟจากด้านบนหน้ากล้อง ดูหรูแบบภาพความงาม', 'butterfly beauty lighting from above'],
    ['split', 'Split light', 'แสงครึ่งหน้า', 'Half the face lit, half in shadow.', 'หน้าสว่างครึ่งหนึ่ง มืดครึ่งหนึ่ง ดูลึกลับ', 'split lighting, half the face in shadow'],
    ['rim', 'Rim light', 'ไฟขอบ', 'A bright outline separating subject from background.', 'แสงขอบรอบตัวแบบ แยกออกจากฉากหลัง', 'strong rim light outlining the subject'],
    ['backlit', 'Backlit glow', 'ย้อนแสง', 'Light from behind makes hair and edges glow.', 'แสงจากด้านหลัง ทำให้ผมและขอบเรืองแสง', 'backlit, glowing edges and hair'],
    ['softbox-product', 'Product softbox', 'ไฟซอฟต์บ็อกซ์สินค้า', 'Large soft sources and clean reflections for products.', 'แหล่งแสงนุ่มขนาดใหญ่ เงาสะท้อนสะอาด เหมาะกับสินค้า', 'large softbox product lighting, clean reflections'],
    ['studio-white', 'White studio seamless', 'สตูดิโอพื้นขาว', 'Even light on a pure white backdrop.', 'แสงเรียบบนฉากขาวล้วน ดูเป็นมืออาชีพ', 'evenly lit white seamless studio backdrop'],
    ['neon', 'Neon night', 'ไฟนีออน', 'Saturated colored signs light the scene.', 'ไฟป้ายนีออนหลากสีส่องฉาก ดูเมืองยามค่ำ', 'neon signs lighting the scene, saturated colors'],
    ['practical', 'Practical lamps', 'ไฟจากโคมในฉาก', 'Lamps and screens in the scene are the light.', 'ใช้โคมไฟหรือจอในฉากเป็นแหล่งแสง', 'lit by practical lamps within the scene'],
    ['candle', 'Candlelight', 'แสงเทียน', 'Warm flickering low light.', 'แสงเทียนอุ่น ๆ ไหววูบ', 'warm flickering candlelight'],
    ['moonlight', 'Moonlight', 'แสงจันทร์', 'Cool blue night light.', 'แสงกลางคืนสีฟ้าเย็น', 'cool blue moonlight'],
    ['god-rays', 'God rays', 'ลำแสงทะลุ', 'Beams of light through haze or windows.', 'ลำแสงส่องผ่านหมอกหรือหน้าต่าง', 'volumetric god rays through haze'],
    ['haze', 'Atmospheric haze', 'หมอกบาง ๆ', 'A light haze softens and layers the depth.', 'หมอกบางเพิ่มมิติและความนุ่มให้ภาพ', 'light atmospheric haze adding depth'],
    ['colored-gels', 'Colored gels', 'ไฟเจลสี', 'Two contrasting colored lights, often teal and magenta.', 'ไฟสองสีตัดกัน เช่น ฟ้าอมเขียวกับชมพู', 'two-tone colored gel lighting, contrasting hues'],
    ['top-light', 'Top light', 'ไฟจากด้านบน', 'Overhead light with shadowed eyes, tense.', 'ไฟจากเหนือศีรษะ ดวงตาอยู่ในเงา ดูตึงเครียด', 'hard top light from directly above'],
    ['under-light', 'Under light', 'ไฟจากด้านล่าง', 'Light from below for an eerie feel.', 'ไฟส่องจากด้านล่าง ดูน่าขนลุก', 'eerie under lighting from below'],
    ['flash', 'Direct flash', 'แฟลชตรง', 'On-camera flash, bold and editorial.', 'แฟลชติดกล้อง ดูจัดจ้านแบบนิตยสาร', 'direct on-camera flash, bold editorial look'],
    ['firelight', 'Firelight', 'แสงไฟกองไฟ', 'Warm moving light from a fire.', 'แสงอุ่นที่ขยับไหวจากกองไฟ', 'warm moving firelight'],
    ['screen-glow', 'Screen glow', 'แสงจากจอ', 'A face lit by a phone or monitor.', 'ใบหน้าที่ได้แสงจากจอโทรศัพท์หรือคอมพิวเตอร์', 'face lit by the cool glow of a screen'],
    ['dappled', 'Dappled light', 'แสงลอดใบไม้', 'Sunlight broken by leaves into patches.', 'แสงแดดลอดใบไม้เป็นจุด ๆ ดูสดชื่น', 'dappled sunlight through leaves'],
  ]),
  ...rows('composition', [
    ['thirds', 'Rule of thirds', 'กฎสามส่วน', 'The subject sits on a third line, balanced and natural.', 'วางตัวแบบบนเส้นแบ่งสามส่วน ดูสมดุลเป็นธรรมชาติ', 'rule of thirds composition'],
    ['center', 'Centered subject', 'วางกลางภาพ', 'The subject right in the middle, strong and direct.', 'ตัวแบบอยู่กลางเฟรม ดูเด่นและตรงไปตรงมา', 'subject centered in the frame'],
    ['symmetry', 'Perfect symmetry', 'สมมาตร', 'Both halves mirror each other, precise and stylized.', 'ภาพสองฝั่งเหมือนกัน ดูเป๊ะและมีสไตล์', 'perfectly symmetrical composition'],
    ['leading-lines', 'Leading lines', 'เส้นนำสายตา', 'Lines in the scene guide the eye to the subject.', 'เส้นในฉากพาสายตาไปที่ตัวแบบ', 'leading lines guiding the eye to the subject'],
    ['frame-in-frame', 'Frame within a frame', 'กรอบซ้อนกรอบ', 'A doorway or window frames the subject.', 'ใช้ประตูหรือหน้าต่างเป็นกรอบล้อมตัวแบบ', 'subject framed by a doorway or window'],
    ['negative-space', 'Negative space', 'พื้นที่ว่าง', 'Lots of empty space around a small subject.', 'พื้นที่ว่างเยอะรอบตัวแบบ ดูเรียบหรือเหงา', 'generous negative space around the subject'],
    ['foreground', 'Foreground layer', 'มีฉากหน้า', 'Something soft in the foreground adds depth.', 'มีวัตถุเบลอด้านหน้าเพิ่มความลึก', 'soft foreground element adding depth'],
    ['depth-layers', 'Depth layers', 'ชั้นความลึก', 'Foreground, subject and background all read clearly.', 'ฉากหน้า ตัวแบบ ฉากหลัง เห็นเป็นชั้นชัดเจน', 'layered composition with foreground, midground and background'],
    ['diagonal', 'Diagonal energy', 'แนวทแยง', 'Diagonal lines add movement and tension.', 'เส้นทแยงเพิ่มพลังและความเคลื่อนไหว', 'strong diagonal composition'],
    ['golden-ratio', 'Golden spiral', 'เกลียวทองคำ', 'The eye spirals into the subject.', 'สายตาวนเข้าสู่ตัวแบบตามเกลียวทองคำ', 'golden ratio spiral composition'],
    ['headroom-tight', 'Tight framing', 'เฟรมแน่น', 'Little headroom, intimate and intense.', 'เว้นพื้นที่เหนือศีรษะน้อย ดูใกล้ชิดและเข้มข้น', 'tight framing with minimal headroom'],
    ['lead-room', 'Lead room', 'เว้นที่ด้านหน้า', 'Space in front of where the subject looks or moves.', 'เว้นพื้นที่ด้านที่ตัวแบบมองหรือเคลื่อนไป', 'lead room in the direction the subject faces'],
    ['short-side', 'Short-sided frame', 'เว้นที่ด้านหลัง', 'The subject looks toward the near edge, uneasy.', 'ตัวแบบมองชิดขอบเฟรม ให้ความรู้สึกอึดอัด', 'short-sided framing, subject facing the near edge'],
    ['reflection', 'Reflection', 'เงาสะท้อน', 'The subject seen in a mirror, glass or water.', 'เห็นตัวแบบผ่านกระจก กระจกใส หรือผิวน้ำ', 'subject seen in a reflection'],
    ['silhouette-crowd', 'Lone figure', 'คนเดียวท่ามกลางฉาก', 'One person isolated in a large space.', 'คนเดียวโดดเดี่ยวในพื้นที่กว้าง', 'a lone figure isolated in a large space'],
    ['pattern', 'Pattern and repetition', 'ลวดลายซ้ำ', 'Repeating shapes with one break that draws the eye.', 'รูปทรงซ้ำ ๆ มีจุดหนึ่งที่ต่างดึงสายตา', 'repeating pattern with one element breaking it'],
    ['split-screen', 'Split diopter feel', 'ชัดสองระยะ', 'Near and far both sharp at once.', 'ทั้งระยะใกล้และไกลชัดพร้อมกัน', 'split-diopter look, near and far both in focus'],
    ['product-hero', 'Hero product', 'สินค้าพระเอก', 'The product large, centered and slightly low.', 'สินค้าใหญ่ อยู่กลาง มุมต่ำเล็กน้อย ดูเด่น', 'hero product shot, product large and slightly low angle'],
    ['knolling', 'Knolling', 'จัดวางเป็นระเบียบ', 'Items laid out in neat parallel rows, top-down.', 'จัดของเรียงขนานเป็นระเบียบ มองจากด้านบน', 'knolling layout, items in neat parallel rows from above'],
    ['vertical-stack', 'Vertical stack', 'จัดแนวตั้ง', 'Elements stacked top to bottom for 9:16 screens.', 'วางองค์ประกอบเรียงบนลงล่าง เหมาะจอแนวตั้ง', 'vertical stacked composition for a 9:16 frame'],
  ]),
  ...rows('lens', [
    ['ultra-wide', 'Ultra-wide 14mm', 'เลนส์กว้างพิเศษ', 'Dramatic perspective, close objects look huge.', 'มุมมองดราม่า ของใกล้ดูใหญ่มาก', 'ultra-wide 14mm lens, exaggerated perspective'],
    ['wide-24', 'Wide 24mm', 'เลนส์กว้าง 24mm', 'Shows the space while staying natural.', 'เห็นพื้นที่กว้างแต่ยังดูเป็นธรรมชาติ', '24mm wide lens'],
    ['normal-35', 'Normal 35mm', 'เลนส์ 35mm', 'Close to how we see, great for storytelling.', 'ใกล้เคียงสายตาคน เหมาะเล่าเรื่อง', '35mm lens, natural perspective'],
    ['standard-50', 'Standard 50mm', 'เลนส์ 50mm', 'Honest proportions with gentle background blur.', 'สัดส่วนจริง ฉากหลังเบลอเล็กน้อย', '50mm lens'],
    ['portrait-85', 'Portrait 85mm', 'เลนส์พอร์ตเทรต 85mm', 'Flattering faces with creamy background blur.', 'หน้าดูสวย ฉากหลังเบลอนุ่ม', '85mm portrait lens, creamy background blur'],
    ['tele-135', 'Telephoto 135mm', 'เลนส์เทเล 135mm', 'Compresses space, background feels close.', 'บีบระยะ ฉากหลังดูใกล้เข้ามา', '135mm telephoto lens, compressed background'],
    ['macro', 'Macro', 'มาโคร', 'Tiny details at life size or larger.', 'รายละเอียดเล็ก ๆ ขยายเท่าตัวจริงหรือใหญ่กว่า', 'macro lens, extreme detail'],
    ['anamorphic', 'Anamorphic', 'เลนส์อนามอร์ฟิก', 'Wide cinematic feel with oval bokeh and flares.', 'ให้ความรู้สึกหนังจอกว้าง โบเก้วงรีและแสงแฟลร์', 'anamorphic lens, oval bokeh, horizontal flares'],
    ['fisheye', 'Fisheye', 'ฟิชอาย', 'Strongly curved, playful or extreme.', 'ภาพโค้งมาก ดูสนุกหรือสุดโต่ง', 'fisheye lens, strong curvature'],
    ['shallow', 'Shallow depth of field', 'ชัดตื้น', 'Only the subject sharp, the rest melts away.', 'ชัดเฉพาะตัวแบบ ที่เหลือเบลอ', 'shallow depth of field, f/1.4, background melted'],
    ['deep', 'Deep focus', 'ชัดลึก', 'Everything from front to back is sharp.', 'ชัดตั้งแต่ด้านหน้าถึงด้านหลัง', 'deep focus, everything sharp front to back'],
    ['rack-focus', 'Rack focus', 'เปลี่ยนจุดโฟกัส', 'Focus shifts from one subject to another.', 'ย้ายโฟกัสจากสิ่งหนึ่งไปอีกสิ่ง', 'rack focus shifting from foreground to background'],
    ['tilt-shift', 'Tilt-shift miniature', 'ทิลต์ชิฟต์', 'A narrow band of focus makes the world look tiny.', 'โฟกัสแคบเป็นแถบ ทำให้โลกดูเหมือนของจำลอง', 'tilt-shift miniature effect'],
    ['soft-focus', 'Soft focus', 'โฟกัสนุ่ม', 'A dreamy glow over highlights.', 'ภาพนุ่มฝัน ไฮไลต์เรืองแสง', 'soft focus with a dreamy glow'],
    ['bokeh', 'Bokeh lights', 'โบเก้ดวงไฟ', 'Out-of-focus lights become soft circles.', 'ดวงไฟที่หลุดโฟกัสกลายเป็นวงกลมนุ่ม', 'background bokeh circles from lights'],
    ['flare', 'Lens flare', 'แสงแฟลร์', 'A light source flares across the lens.', 'แสงส่องเข้าเลนส์เกิดแฟลร์', 'subtle lens flare'],
    ['vintage-glass', 'Vintage glass', 'เลนส์วินเทจ', 'Softer contrast and character from old lenses.', 'คอนทราสต์นุ่มและมีเอกลักษณ์แบบเลนส์เก่า', 'vintage lens character, softer contrast'],
    ['probe', 'Probe lens', 'เลนส์โพรบ', 'Gets right inside small spaces and products.', 'ลอดเข้าไปในพื้นที่เล็กหรือในตัวสินค้า', 'probe lens moving through tiny spaces'],
    ['focus-pull-product', 'Focus reveal', 'เผยด้วยโฟกัส', 'Starts blurred and pulls sharp onto the product.', 'เริ่มเบลอแล้วค่อยชัดที่สินค้า', 'starts out of focus then pulls sharp onto the product'],
    ['snorricam', 'Body-mounted', 'กล้องติดตัว', 'The camera fixed to the actor; the world moves around them.', 'กล้องติดกับตัวนักแสดง โลกรอบตัวเคลื่อนไหว', 'body-mounted camera, subject fixed while the world moves'],
  ]),
  ...rows('look', [
    ['clean-commercial', 'Clean commercial', 'โฆษณาสะอาดตา', 'Bright, crisp and true colors.', 'สว่าง คม สีตรง แบบโฆษณามืออาชีพ', 'clean commercial look, crisp true colors'],
    ['teal-orange', 'Teal and orange', 'ฟ้าอมเขียวกับส้ม', 'The blockbuster grade: warm skin, cool shadows.', 'โทนหนังฟอร์มยักษ์ ผิวอุ่น เงาเย็น', 'teal and orange color grade'],
    ['warm-film', 'Warm film', 'ฟิล์มโทนอุ่น', 'Warm, nostalgic film colors.', 'สีฟิล์มอุ่น ๆ ชวนคิดถึง', 'warm nostalgic film colors'],
    ['cool-moody', 'Cool and moody', 'โทนเย็นหม่น', 'Desaturated blues and greens.', 'สีฟ้าเขียวอมเทา ดูหม่นลึก', 'cool moody grade, desaturated blues'],
    ['black-white', 'Black and white', 'ขาวดำ', 'Monochrome with rich contrast.', 'ขาวดำ คอนทราสต์สวย', 'black and white, rich contrast'],
    ['noir', 'Film noir', 'ฟิล์มนัวร์', 'Hard shadows in black and white, mystery.', 'เงาแข็งขาวดำ บรรยากาศลึกลับ', 'film noir, hard shadows, black and white'],
    ['35mm-grain', '35mm film grain', 'เกรนฟิล์ม 35mm', 'Organic grain and gentle halation.', 'เกรนฟิล์มธรรมชาติ ขอบแสงฟุ้งเล็กน้อย', '35mm film grain, gentle halation'],
    ['16mm', '16mm documentary', 'ฟิล์ม 16mm', 'Heavier grain, raw and intimate.', 'เกรนหนาขึ้น ดิบและใกล้ชิดแบบสารคดี', '16mm film look, heavier grain'],
    ['super8', 'Super 8 home movie', 'ฟิล์ม Super 8', 'Faded colors and light leaks, like old memories.', 'สีซีดและแสงรั่ว เหมือนหนังบ้านเก่า', 'Super 8 home movie, faded colors, light leaks'],
    ['vhs', 'VHS tape', 'เทป VHS', 'Soft image with color bleed and scan lines.', 'ภาพนุ่ม สีเลอะ มีเส้นสแกน แบบยุค 90', 'VHS tape look, color bleed, scan lines'],
    ['pastel', 'Soft pastel', 'พาสเทล', 'Light, airy pastel colors.', 'สีพาสเทลอ่อนโปร่ง ดูน่ารัก', 'soft airy pastel palette'],
    ['vibrant', 'Vibrant pop', 'สีสดจัด', 'Bold saturated colors that jump off the screen.', 'สีสดจัดจ้าน สะดุดตาบนฟีด', 'vibrant saturated pop colors'],
    ['bleach-bypass', 'Bleach bypass', 'บลีชบายพาส', 'Low saturation, high contrast, gritty.', 'สีจาง คอนทราสต์สูง ดูดิบแข็ง', 'bleach bypass look, low saturation, high contrast'],
    ['monochrome-color', 'Single-color accent', 'สีเดียวเด่น', 'Muted image with one strong accent color.', 'ภาพสีหม่น มีสีเดียวเด่นสะดุดตา', 'muted palette with one strong accent color'],
    ['earthy', 'Earthy natural', 'โทนธรรมชาติ', 'Browns, greens and sand tones.', 'สีน้ำตาล เขียว และทราย ดูอบอุ่นธรรมชาติ', 'earthy natural tones, browns and greens'],
    ['luxury-dark', 'Dark luxury', 'หรูโทนมืด', 'Deep blacks with gold highlights.', 'สีดำลึกกับไฮไลต์สีทอง ดูหรูหรา', 'dark luxury look, deep blacks, gold highlights'],
    ['matte', 'Matte faded', 'แมตต์ซีด', 'Lifted blacks for a soft modern look.', 'ยกเงาดำขึ้น ดูนุ่มทันสมัย', 'matte look with lifted blacks'],
    ['high-contrast', 'High contrast punch', 'คอนทราสต์จัด', 'Deep shadows and bright highlights.', 'เงาเข้มและไฮไลต์สว่าง ดูแรงชัด', 'punchy high contrast'],
    ['sepia', 'Sepia', 'ซีเปีย', 'Brown monochrome like an old photograph.', 'โทนน้ำตาลแบบภาพถ่ายเก่า', 'sepia toned'],
    ['cyberpunk', 'Cyberpunk', 'ไซเบอร์พังก์', 'Magenta and cyan night city glow.', 'แสงชมพูม่วงกับฟ้าแบบเมืองอนาคตยามค่ำ', 'cyberpunk palette, magenta and cyan glow'],
  ]),
  ...rows('pacing', [
    ['real-time', 'Real time', 'ความเร็วจริง', 'Natural speed, nothing altered.', 'ความเร็วปกติ ไม่ปรับแต่ง', 'real-time natural speed'],
    ['slow-motion', 'Slow motion', 'สโลว์โมชัน', 'Slowed down to savor a moment.', 'ช้าลงให้ดื่มด่ำช่วงเวลา', 'smooth slow motion'],
    ['high-speed', 'High-speed splash', 'สโลว์โมชันจัด', 'Very slow, liquids and particles hang in the air.', 'ช้ามากจนของเหลวและเศษผงลอยค้าง', 'ultra slow motion, droplets frozen in the air'],
    ['speed-ramp', 'Speed ramp', 'เร่งแล้วชะลอ', 'Speeds up then slows down on the key moment.', 'เร่งความเร็วแล้วชะลอตรงจังหวะสำคัญ', 'speed ramp, fast then slowing into the key moment'],
    ['timelapse', 'Time-lapse', 'ไทม์แลปส์', 'Hours pass in seconds.', 'เวลาหลายชั่วโมงผ่านไปในไม่กี่วินาที', 'time-lapse, time passing quickly'],
    ['hyperlapse', 'Hyperlapse', 'ไฮเปอร์แลปส์', 'Time-lapse while the camera travels.', 'ไทม์แลปส์ขณะกล้องเคลื่อนที่', 'hyperlapse moving through the location'],
    ['freeze', 'Freeze frame', 'หยุดภาพ', 'The action pauses on a striking moment.', 'หยุดภาพค้างไว้ตรงจังหวะเด่น', 'action freezing on a striking moment'],
    ['stop-motion', 'Stop motion', 'สต็อปโมชัน', 'Objects move in small handmade steps.', 'ของขยับทีละนิดแบบงานทำมือ', 'stop-motion style movement'],
    ['one-take', 'Continuous take', 'ช็อตยาวต่อเนื่อง', 'One unbroken shot that follows the action.', 'ช็อตเดียวยาวต่อเนื่อง ไม่ตัด', 'one continuous unbroken take'],
    ['beat-hit', 'Beat-synced motion', 'ขยับตามจังหวะ', 'Movements land on a steady rhythm.', 'การเคลื่อนไหวลงจังหวะสม่ำเสมอ เหมาะใส่เพลง', 'movements landing on a steady rhythmic beat'],
  ]),
]

const BY_ID = new Map(CINEMATIC_TECHNIQUES.map(t => [t.id, t]))

/** Only known ids, at most one per group, in group order. */
export function normalizeCinematic(input: unknown): string[] {
  if (!Array.isArray(input)) return []
  const picked = new Map<CinematicGroup, string>()
  for (const id of input) {
    const t = typeof id === 'string' ? BY_ID.get(id) : undefined
    if (t && !picked.has(t.group)) picked.set(t.group, t.id)
  }
  return CINEMATIC_GROUPS.map(g => picked.get(g.id)).filter((id): id is string => !!id)
}

/** The "Cinematography:" line for a prompt, or '' when nothing applies. Movement and timing only reach video. */
export function cinematicPrompt(ids: unknown, kind: 'image' | 'video'): string {
  const parts = normalizeCinematic(ids).map(id => BY_ID.get(id)!)
    .filter(t => CINEMATIC_GROUPS.find(g => g.id === t.group)![kind])
    .map(t => t.prompt)
  return parts.length ? `Cinematography: ${parts.join('; ')}` : ''
}
