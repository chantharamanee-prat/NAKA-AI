# naka-ai "ฟ้าหลังฝน" reel: design system

Concept, one line: a seller's grey day (can't film, can't edit, can't go live) is the rain; one product
photo falls like the last drop; Naka turns it into sales clips while the sky clears; the logo signs it.

Format: 1920 x 1080, 60 fps, 15 s, 120 BPM (1 beat = 0.5 s = 30 frames). Every cue is written as `b(n)`.
Built for the naka-ai.com home page (same tokens as `apps/landing/public/ui-land.css`).

## Colour

| Role | Value | Where it comes from |
|---|---|---|
| Ground | `#F3F7FB` | rain-washed pale blue, the site's `--bg` |
| Ink | `#14233B` | cloud navy, the site's `--ink` |
| Sky | `#DCEBFA` to `oklch(0.72 0.105 246)` | the site's hero shader, rain palette to clear palette |
| Brand | `#1D50BE` | Naka's cobalt, the logo square |
| Accent | `#F97316` | the studio's action orange, here also the Thai tea itself |

Colour shifts are interpolated in OKLCH. No purple, no neon, no gradients without a reason: the only
gradient is the sky.

## Type

- Display: Kanit 700 / 600 (Thai + Latin), embedded from `assets/fonts/`. Headlines 150 to 220 px.
- Text: IBM Plex Sans Thai 500, 34 px minimum, only for captions and the fine print.
- Thai words are never split inside a word; lines break between phrases.

## Grid and shape

12-column grid, 96 px margins. Shape language: rain streaks (diagonal lines), a drop and its ripples
(circles), phones (9:16 rounded rectangles, 36 px radius), sun rays (lines again). Every scene hands its
shape to the next: streaks converge into the drop, the ripple becomes the photo's mask, the photo splits
into phones, the phones whip away into sun rays, the rays draw the logo's N.

## Motion language

Calm sky, sharp beats. One entrance ease for type, `expo.out`; overshoot (`back.out(1.8)`) only for things
that land (phones, Naka, the logo head); `power2.inOut` for the camera. Motion blur only on the phones'
whip exit. Stagger 60 ms, from the centre for the phones.

## Timeline (b(n) = n x 0.5 s)

| Beats | Time | Scene | What happens | Sound |
|---|---|---|---|---|
| b0 to b6 | 0 to 3 s | Rain | grey sky, diagonal rain; "ถ่ายไม่เป็น" b0.5, "ตัดต่อไม่เป็น" b2, "ไลฟ์ไม่ไหว" b3.5 slam up through masks | rain bed, low thump per word |
| b6 to b10 | 3 to 5 s | The drop | rain freezes b6, streaks converge to the centre, one drop falls b7, impact b8: ripples open a circle that reveals the Thai tea photo; "แค่มีรูปสินค้า 1 รูป" | drop plink b7, impact b8 |
| b10 to b20 | 5 to 10 s | Naka makes | the photo shrinks to a node b10.5; four phones burst out b11 in a 3D arc (review, drama, AI Live, chat bot), punch forward one per beat b12 to b15; giant outline "คลิปขาย" behind; the sky starts clearing b12; riser b18; phones whip off b19.5 | four-on-the-floor kick b11 to b19, hats, riser |
| b20 to b26 | 10 to 13 s | The sky clears | sun breaks through with rays b20; Naka rises with an overshoot b20.5; "ที่เหลือ นาคาทำให้หมด" | bell b20, warm pad |
| b26 to b30 | 13 to 15 s | Signature | the N draws itself b26, the head settles b27, "naka-ai." and "แค่มีรูปสินค้า ก็ได้คลิปขาย"; fine print | two-note sting b26 |

## Honesty

The phones show posters of real clips from the naka-ai library (`public/showcase/h3/`), and the Thai tea
photo is the first frame of the library's real "ชาไทยเย็น" clip. The end card says
"ตัวอย่างสาธิต · คลิปในมือถือทำด้วยนาคา".
