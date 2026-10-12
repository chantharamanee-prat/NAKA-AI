// Write the landing clip library into public/index.html between <!-- reel:start --> and <!-- reel:end -->:
// one section per studio menu that has clips (คลังสกิล, สตูดิโอละคร, AI Live) plus the chat bot, each a grid of
// 9:16 clips under a heading with the menu's real name, what it makes and the button that opens it. Two rows
// show; "ดูอีก N คลิป" opens two more each time (never a sideways scroll). Then the menus with no clips yet.
// Cards come from three sources: every shot in shots.json that generate.cjs has rendered to
// public/showcase/h3/<id>.mp4 ("row", or the href, decides its tab), the 50 sample clips in
// clips.json (public/showcase/clips/), and the chat demos in chat-cards.html. Until six H3 clips
// are rendered, the shots.json fallback clips fill in. public/rails.js runs "ดูอีก" and the lazy posters;
// src/content/showcase.ts reads the cards back (admins hide, order and upload clips) and refills each grid
// (still called a track: <div class="g-track" data-cats> ... <!-- /track -->).
//   node creative/unsloth-reel/build-reel.cjs
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const INDEX = path.join(ROOT, 'public', 'index.html');
const H3_DIR = path.join(ROOT, 'public', 'showcase', 'h3');
const START = '<!-- reel:start -->';
const END = '<!-- reel:end -->';

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const SPEAKER = '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="spk" d="M4 9h4l5-4v14l-5-4H4z"/><path class="on" d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12"/><path class="off" d="M16.5 9.5l5 5m0-5l-5 5"/></svg>';

// The rows, in order: what the menu makes, in the seller's words, and the button that opens it.
const RAILS = [
  { id: 'review', menu: 'คลังสกิล', title: 'วิดีโอรีวิวสินค้า', text: 'ใส่รูปสินค้า 1 รูป แล้วเลือกแบบคลิป นาคาเขียนบทและพากย์เสียงไทยให้ ลง TikTok Shopee และ Lazada ได้เลย', cta: 'เปิดคลังสกิล', href: '/go/studio/skills' },
  { id: 'drama', menu: 'สตูดิโอละคร', title: 'ละครสั้น AI', text: 'ละครเป็นตอน ๆ ให้คนดูกลับมาดูต่อ นาคาสร้างตัวละคร ฉาก และวิดีโอทีละตอน แล้วรวมเป็นคลิปเดียว', cta: 'เปิดสตูดิโอละคร', href: '/go/studio/drama' },
  { id: 'live', menu: 'AI Live', title: 'ไลฟ์ขายด้วยอวตาร', text: 'อวตารพูดไทยตามสคริปต์ขาย ตอบคอมเมนต์จากข้อมูลร้าน และไลฟ์ออก TikTok หรือ Facebook', cta: 'เปิด AI Live', href: '/go/studio/live' },
  { id: 'bot', menu: 'กล่องข้อความใน naka-ai', title: 'แชทบอทตอบลูกค้า', text: 'ตอบแชทและคอมเมนต์ด้วยข้อมูลของร้าน เรื่องที่ต้องตัดสินใจส่งต่อให้คนในร้าน', cta: 'ตั้งค่าแชทบอท', href: '/app/inbox/' },
];
const CATS = RAILS.map(r => r.id);
// the first row of each grid shows its posters at once; rails.js sets the rest when they are shown and close
const EAGER = 6;
// the studio menus with no clips in the library yet: Naka clips tagged as illustration, never as output
const MORE = [
  { menu: 'viral-clone', clip: 'anim-director', title: 'คลิปที่ขายดีอยู่แล้ว ทำต่อได้ทั้งชุด', text: 'ใส่คลิปต้นแบบ 1 คลิป แล้วเปลี่ยนประโยคเปิด สินค้า คนพูด หรือภาษา ได้คลิปโฆษณาหลายแบบ', cta: 'เปิดสตูดิโอโคลนไวรัล' },
  { menu: 'seller', clip: 'anim-writing', title: 'คลิปเสร็จแล้ว ได้โพสต์ขายพร้อมลง', text: 'แคปชัน แฮชแท็ก และคอมเมนต์ปักหมุดพร้อมลิงก์สินค้า เขียนแยกให้แต่ละแพลตฟอร์ม', cta: 'เปิด AI นักขาย' },
  { menu: 'marketer', clip: 'anim-review', title: 'ยังไม่รู้จะโฆษณาอะไร ให้นาคาช่วยคิด', text: 'เล่าเรื่องสินค้า นาคาวิจัยตลาด เสนอไอเดียโฆษณา แล้วส่งต่อไปทำวิดีโอได้เลย', cta: 'เปิดนักการตลาด AI' },
  { menu: 'social', clip: 'bt-comments', title: 'คอมเมนต์จากทุกเพจ รวมในบอร์ดเดียว', text: 'Social ดึงคอมเมนต์จากเพจที่เชื่อมไว้มารวมในบอร์ดเดียว ดูและตอบได้จากที่เดียว', cta: 'เปิด Social' },
];

const { shots, fallback } = JSON.parse(fs.readFileSync(path.join(__dirname, 'shots.json'), 'utf8'));
const isRendered = s => fs.existsSync(path.join(H3_DIR, `${s.id}.mp4`));
// "app" shots are the in-app mascot animations, not landing samples
const rendered = shots.filter(s => s.row !== 'app' && isRendered(s));
const fill = rendered.length < 6 ? fallback : [];

// the 50 sample clips: drama and live keep their tab, shop scenes (packing, orders, handoff) show
// what the bot works alongside, every other product group is a review clip
const lib = JSON.parse(fs.readFileSync(path.join(__dirname, 'clips.json'), 'utf8'));
const CLIPS_DIR = path.join(ROOT, 'public', 'showcase', 'clips');
const libCat = g => (g === 'drama' || g === 'live') ? g : g === 'shop' ? 'bot' : 'review';
const TRY = {
  review: ['ทำแบบนี้ในคลังสกิล →', '/go/studio/skills'],
  drama: ['ทำละครแบบนี้ →', '/go/studio/drama'],
  live: ['ตั้งค่าไลฟ์ →', '/go/studio/live'],
  bot: ['ตั้งค่าบอท →', '/app/inbox/'],
};
// review clips alternate product groups so a row never opens on eight of one kind
function interleave(list, key) {
  const groups = [...new Set(list.map(key))].map(k => list.filter(x => key(x) === k));
  const out = [];
  for (let i = 0; out.length < list.length; i++) for (const g of groups) if (g[i]) out.push(g[i]);
  return out;
}
const libClips = interleave(lib.clips.filter(c => fs.existsSync(path.join(CLIPS_DIR, `${c.id}.mp4`))), c => c.group);

// row of a shot: its row, else read from where its button leads; anything else joins the end of the review row
function catOf(s) {
  if (CATS.includes(s.row)) return s.row;
  const href = String(s.href || '');
  if (href === '/go/studio/skills') return 'review';
  if (href.startsWith('/app/inbox')) return 'bot';
  const m = /^\/go\/studio\/(drama|live)$/.exec(href);
  return m ? m[1] : 'naka';
}

function card({ cat, href, poster, sources, chip, live, title, sub, tryLabel, from, sound }, i) {
  return `        <article class="g-card" data-cat="${cat}">
          <video data-autoplay muted loop playsinline preload="none" ${i < EAGER ? '' : 'data-'}poster="${esc(poster)}" aria-hidden="true">${sources.map(([src, type]) => `<source src="${esc(src)}" type="${type}">`).join('')}</video>
          <span class="g-chip${live ? ' is-live' : ''}">${esc(chip.replace(/^●\s*/, ''))}</span>
${from ? `          <figure class="g-from"><img src="${esc(from)}" width="180" height="320" loading="lazy" alt="รูปตั้งต้นของคลิป ${esc(title)}"><figcaption>จากรูปนี้</figcaption></figure>\n` : ''}${sound ? `          <button class="reel-sound" type="button" aria-pressed="false" aria-label="เปิดเสียงคลิป ${esc(title)}">${SPEAKER}</button>\n` : ''}          <div class="g-cap"><strong class="g-title">${esc(title)}</strong>${sub ? `<p>${esc(sub)}</p>` : ''}<a class="g-use" href="${esc(href)}">${esc(tryLabel)}</a></div>
        </article>`;
}

// product clips lead each tab; the clips starring Naka herself follow them
const isNaka = s => /(^|-)naka(-|$)/.test(s.id);
const ordered = [...rendered.filter(s => !isNaka(s)), ...rendered.filter(isNaka)];
const items = [
  ...ordered.map(s => ({
    cat: catOf(s), href: (TRY[catOf(s)] || [null, s.href])[1], poster: `/showcase/h3/${s.id}.jpg`, sources: [[`/showcase/h3/${s.id}.mp4`, 'video/mp4']],
    chip: s.chip, live: s.chip_class === 'tpl-chip-live' || /^●/.test(s.chip), title: s.title, sub: s.sub, tryLabel: (TRY[catOf(s)] || [s.try])[0],
    from: s.first_frame && fs.existsSync(path.join(H3_DIR, `${s.id}-from.jpg`)) ? `/showcase/h3/${s.id}-from.jpg` : null,
    sound: true,
  })),
  ...fill.map(f => ({ cat: catOf(f), href: f.href, poster: f.poster, sources: f.sources, chip: f.chip, title: f.title, sub: f.sub, tryLabel: f.try })),
  ...libClips.map(c => {
    const cat = libCat(c.group);
    return {
      cat, href: TRY[cat][1], poster: `/showcase/clips/${c.id}.jpg`, sources: [[`/showcase/clips/${c.id}.mp4`, 'video/mp4']],
      chip: lib.groups[c.group] || c.group, live: c.group === 'live', title: c.title, sub: '', tryLabel: TRY[cat][0], sound: true,
    };
  }),
];

// chat demos join their row as the third card
const chats = fs.readFileSync(path.join(__dirname, 'chat-cards.html'), 'utf8')
  .split(/(?=<article )/).filter(b => b.startsWith('<article '))
  .map(b => ({ cat: /data-cat="(\w+)"/.exec(b)[1], html: b.trim().split('\n').map(l => '        ' + l).join('\n') }));

// One track per row: product clips first, clips starring Naka after them; the Naka-only clips close the review row.
const starsNaka = it => /\/(naka-[\w-]+|[\w]+-naka)\.jpg$/.test(it.poster);
const rows = Object.fromEntries(CATS.map(c => {
  const inRow = items.filter(it => it.cat === c || (c === 'review' && it.cat === 'naka'));
  return [c, [...inRow.filter(it => !starsNaka(it)), ...inRow.filter(starsNaka)]];
}));
const tracks = Object.fromEntries(CATS.map(c => {
  const cards = rows[c].map(card);
  chats.filter(ch => ch.cat === c).forEach((ch, i) => cards.splice(2 + i * 3, 0, ch.html));
  return [c, cards];
}));
const videoCount = items.length;
const count = c => tracks[c].length;

const note = [
  'ทุกคลิปสร้างด้วย AI ทั้งภาพและเสียง สินค้า ร้าน และตัวละครเป็นตัวอย่างสมมติ',
  rendered.length && 'คลิปที่มีป้าย “จากรูปนี้” เริ่มจากภาพนิ่งในป้าย สร้างด้วยโมเดลวิดีโอ MiniMax H3 ที่รันผ่าน Unsloth',
  fill.length && 'คลิปละครสร้างจากระบบละครของนาคา',
  chats.length && 'การ์ดแชทเป็นตัวอย่างบทสนทนา',
].filter(Boolean).join(' · ');

const rail = r => `      <div class="g-rail" id="p-${r.id}" data-rail>
        <div class="g-shell g-rail-head">
          <div class="g-rail-copy"><p class="g-menu">${esc(r.menu)}</p><h3 id="rail-${r.id}">${esc(r.title)} <span class="g-count"><b data-rail-count="${r.id}">${count(r.id)}</b> คลิป</span></h3><p>${esc(r.text)}</p></div>
          <div class="g-rail-ctl"><a class="btn btn-primary btn-sm" href="${esc(r.href)}">${esc(r.cta)} <span aria-hidden="true">→</span></a></div>
        </div>
        <div class="g-track" id="track-${r.id}" data-cats="${r.id === 'review' ? 'review naka' : r.id}">
${tracks[r.id].join('\n')}
        </div><!-- /track -->
        <div class="g-shell g-more"><button class="g-more-btn" type="button" data-more aria-controls="track-${r.id}" hidden>ดูอีก <span data-more-count></span> คลิป <i aria-hidden="true">↓</i></button></div>
      </div>`;
const more = m => `          <li id="mo-li-${m.menu}"><a class="st-card" href="/go/studio/${m.menu}" aria-labelledby="mo-${m.menu}" aria-describedby="mo-${m.menu}-d"><span class="st-clip is-illus"><video data-autoplay muted loop playsinline preload="none" poster="/showcase/menu/${m.clip}.jpg" aria-hidden="true"><source src="/showcase/menu/${m.clip}.mp4" type="video/mp4"></video><em>ภาพประกอบ</em></span><h3 id="mo-${m.menu}">${esc(m.title)}</h3><span class="st-text" id="mo-${m.menu}-d">${esc(m.text)}</span><span class="st-go">${esc(m.cta)} <span aria-hidden="true">→</span></span></a></li>`;

const block = `${START}
    <!-- generated by creative/unsloth-reel/build-reel.cjs; edit shots.json, chat-cards.html or the script, not this block.
         "ฟรี 7 วัน" is the trial in migrations/pg/0012_free_trial.sql; tests/entitlements.test.cjs keeps the two equal. -->
    <section class="g-gallery" id="reel" aria-labelledby="reel-title" data-gallery>
      <span class="g-anchor" id="studio"></span>
      <div class="g-shell g-head">
        <p class="g-kicker">คลังคลิปจริง · ${videoCount} คลิป</p>
        <h2 id="reel-title">ดูงานจริงของทุกเมนู<em class="nw">ใน Naka Studio</em></h2>
        <p class="g-sub">ทุกคลิปทำด้วยนาคา พร้อมเสียงพากย์ไทย แตะลำโพงเพื่อฟังเสียง กดปุ่มใต้คลิปเพื่อเริ่มจากแบบเดียวกัน หรือกด "ดูอีก" ใต้แต่ละเมนู</p>
        <p class="st-trial"><span class="st-badge">ฟรี 7 วัน</span>สมัครแล้วเข้าได้ทุกเมนู</p>
      </div>
${RAILS.map(rail).join('\n')}
      <div class="g-rail g-more-menus" id="p-more">
        <div class="g-shell g-rail-head"><div class="g-rail-copy"><p class="g-menu">สตูดิโอโคลนไวรัล · AI นักขาย · นักการตลาด AI · Social</p><h3 id="rail-more">เมนูอื่นใน Naka Studio</h3><p>ยังไม่มีคลิปในคลัง คลิปบนการ์ดเป็นภาพประกอบ ไม่ใช่ผลงานของเมนูนั้น</p></div></div>
        <ol class="g-shell st-grid st-more" aria-labelledby="rail-more">
${MORE.map(more).join('\n')}
        </ol>
        <div class="g-shell st-note"><p>หลังครบ 7 วัน เมนูที่เปิดได้ขึ้นกับแพ็กเกจของร้าน</p><a href="/app/billing/">ดูแพ็กเกจ</a><a href="/app/inbox/">แชทบอทตอบลูกค้า</a></div>
      </div>
      <p class="g-shell g-note">${esc(note)}</p>
    </section>
    ${END}`;

const html = fs.readFileSync(INDEX, 'utf8');
const a = html.indexOf(START);
const b = html.indexOf(END);
if (a < 0 || b < a) throw new Error(`markers ${START} ... ${END} not found in public/index.html`);
fs.writeFileSync(INDEX, html.slice(0, a) + block + html.slice(b + END.length));
console.log(`library: ${videoCount} clip(s) (${fill.length} filler), ${chats.length} chat demo(s) · ${CATS.map(c => `${c} ${count(c)}`).join(', ')}`);
