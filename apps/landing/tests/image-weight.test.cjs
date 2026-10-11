// Page weight: the images the public pages and the member pages load stay light. The hero mascot is preloaded
// (it is the largest thing painted first), and the share card is what LINE and Facebook fetch for link previews.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { existsSync, readFileSync, statSync } = require('node:fs');
const path = require('node:path');

const pub = path.resolve(__dirname, '..', 'public');
const read = (rel) => readFileSync(path.join(pub, rel), 'utf8');
const PAGES = ['index.html', 'en/index.html', 'app/index.html', 'login/index.html'];
const KB = 1024;

function localImages(html) {
  const urls = [
    ...[...html.matchAll(/<img\b[^>]*\bsrc="(\/[^"?#]+)/g)].map((m) => m[1]),
    ...[...html.matchAll(/<link rel="preload" as="image" href="(\/[^"?#]+)/g)].map((m) => m[1]),
  ];
  return [...new Set(urls)].filter((u) => /\.(png|jpe?g|webp|avif)$/i.test(u));
}

test('every image a page shows or preloads exists and stays under 200 KB', () => {
  for (const page of PAGES) {
    for (const url of localImages(read(page))) {
      const file = path.join(pub, url);
      assert.ok(existsSync(file), `${page}: ${url} exists`);
      assert.ok(statSync(file).size < 200 * KB, `${page}: ${url} is ${Math.round(statSync(file).size / KB)} KB`);
    }
  }
});

test('the preloaded hero mascot is a small WebP; the full-size mascot PNG is not used by pages', () => {
  for (const page of ['index.html', 'en/index.html']) {
    const html = read(page);
    assert.match(html, /<link rel="preload" as="image" href="\/assets\/naka-plush-320\.webp">/, page);
  }
  assert.ok(statSync(path.join(pub, 'assets/naka-plush-320.webp')).size < 60 * KB);
  for (const page of PAGES) assert.doesNotMatch(read(page), /naka-plush-sales\.png|naka-plush-320\.png/, page);
});

test('the share card for link previews is a 1200x630 JPEG under 300 KB', () => {
  for (const page of ['index.html', 'en/index.html']) {
    const html = read(page);
    assert.match(html, /<meta property="og:image" content="https:\/\/naka-ai\.com\/assets\/naka-share-card\.jpg\?v=5">/, page);
    assert.match(html, /<meta name="twitter:image" content="https:\/\/naka-ai\.com\/assets\/naka-share-card\.jpg\?v=5">/, page);
  }
  assert.ok(statSync(path.join(pub, 'assets/naka-share-card.jpg')).size < 300 * KB);
});
