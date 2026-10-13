// Score for the reel, Node built-ins only: writes assets/audio/score.wav (48 kHz, 16-bit, stereo).
// Every event is placed from the same beat table as the picture (src/config.js).
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
await import(new URL("../src/config.js", import.meta.url));
const CFG = globalThis.CFG;
const { b, cue } = CFG;

const SR = 48000;
const N = Math.round(CFG.DURATION_SEC * SR);
const L = new Float32Array(N), R = new Float32Array(N);

// seeded noise so the file is identical on every run
let seed = 12345;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 * 2 - 1; };
const add = (i, v, pan = 0) => { if (i >= 0 && i < N) { L[i] += v * (1 - Math.max(0, pan)); R[i] += v * (1 + Math.min(0, pan)); } };
const smooth = (x) => x * x * (3 - 2 * x);

// ---------- rain bed: two filtered noise layers, gone by the time the sky has cleared ----------
{
  let lp1 = 0, lp2 = 0, hp = 0, prev = 0;
  const end = b(cue.clearTo);
  for (let i = 0; i < N; i++) {
    const t = i / SR;
    const n = rnd();
    lp1 += 0.08 * (n - lp1);           // body
    hp = 0.97 * (hp + n - prev); prev = n; // hiss
    lp2 += 0.35 * (hp - lp2);
    let env = 1;
    if (t < 0.4) env = t / 0.4;
    if (t > b(cue.freeze)) env = 0.35;                 // the rain holds its breath when it freezes
    if (t > b(cue.impact)) env = 0.35 * (1 - smooth(Math.min(1, (t - b(cue.impact)) / (end - b(cue.impact)))));
    const v = (lp1 * 0.5 + lp2 * 0.22) * env * 0.5;
    L[i] += v; R[i] += v * 0.9 + lp2 * env * 0.03;
  }
}

// ---------- voices ----------
function kick(t0, gain = 1, f0 = 140, f1 = 42, len = 0.35) {
  const s = Math.round(t0 * SR);
  let ph = 0;
  for (let k = 0; k < len * SR; k++) {
    const x = k / SR;
    const f = f1 + (f0 - f1) * Math.exp(-x * 28);
    ph += (2 * Math.PI * f) / SR;
    const env = Math.exp(-x * 9) * Math.min(1, k / 40);
    add(s + k, Math.sin(ph) * env * 0.9 * gain);
  }
}
function hat(t0, gain = 1, pan = 0) {
  const s = Math.round(t0 * SR);
  let prev = 0;
  for (let k = 0; k < 0.06 * SR; k++) {
    const n = rnd();
    const h = n - prev; prev = n;
    add(s + k, h * Math.exp(-(k / SR) * 70) * 0.12 * gain, pan);
  }
}
function impact(t0, gain = 1) {
  kick(t0, 1.3 * gain, 110, 32, 0.9);
  const s = Math.round(t0 * SR);
  let lp = 0;
  for (let k = 0; k < 0.8 * SR; k++) {
    lp += 0.15 * (rnd() - lp);
    add(s + k, lp * Math.exp(-(k / SR) * 6) * 0.5 * gain);
  }
}
function thump(t0) {
  kick(t0, 0.75, 90, 45, 0.3);
  hat(t0, 1.4);
}
function plink(t0) { // a water drop: a short upward chirp
  const s = Math.round(t0 * SR);
  let ph = 0;
  for (let k = 0; k < 0.12 * SR; k++) {
    const x = k / SR;
    const f = 700 + 1400 * Math.min(1, x / 0.03);
    ph += (2 * Math.PI * f) / SR;
    add(s + k, Math.sin(ph) * Math.exp(-x * 40) * 0.35);
  }
}
function bell(t0, f, gain = 1, pan = 0) {
  const s = Math.round(t0 * SR);
  const parts = [[1, 1], [2.01, 0.45], [3.02, 0.22], [4.17, 0.12]];
  for (let k = 0; k < 2.6 * SR; k++) {
    const x = k / SR;
    let v = 0;
    for (const [m, a] of parts) v += Math.sin(2 * Math.PI * f * m * x) * a * Math.exp(-x * (1.6 + m));
    add(s + k, v * 0.16 * gain * Math.min(1, k / 60), pan);
  }
}
function riser(t0, t1) {
  const s = Math.round(t0 * SR), e = Math.round(t1 * SR);
  let ph = 0, hp = 0, prev = 0;
  for (let i = s; i < e; i++) {
    const x = (i - s) / (e - s);
    const f = 180 + 700 * x * x;
    ph += (2 * Math.PI * f) / SR;
    const n = rnd(); hp = 0.9 * (hp + n - prev); prev = n;
    add(i, (Math.sin(ph) * 0.12 + hp * 0.12) * x * x);
  }
}
function whoosh(t0, len = 0.45) {
  const s = Math.round(t0 * SR);
  let lp = 0;
  for (let k = 0; k < len * SR; k++) {
    const x = k / (len * SR);
    const a = 0.02 + 0.5 * Math.sin(Math.PI * x);
    lp += a * (rnd() - lp);
    add(s + k, lp * Math.sin(Math.PI * x) * 0.6, x * 2 - 1);
  }
}
function pad(t0, t1, freqs) { // warm sky after the rain
  const s = Math.round(t0 * SR), e = Math.min(N, Math.round(t1 * SR));
  for (let i = s; i < e; i++) {
    const x = (i - s) / SR, dur = (e - s) / SR;
    const env = smooth(Math.min(1, x / 1.2)) * smooth(Math.min(1, (dur - x) / 0.8));
    let v = 0;
    for (const [j, f] of freqs.entries()) v += Math.sin(2 * Math.PI * f * x + j) * (1 + 0.3 * Math.sin(x * 2 + j));
    add(i, (v / freqs.length) * env * 0.09, Math.sin(x * 0.7) * 0.3);
  }
}

// ---------- the score ----------
cue.pains.forEach((n) => thump(b(n)));
plink(b(cue.drop));
impact(b(cue.impact));
for (let n = cue.phonesOut; n < cue.whip; n += 1) kick(b(n), n === cue.phonesOut ? 1.1 : 0.8);
for (let n = cue.punches[0] + 0.5; n < cue.whip; n += 1) hat(b(n), 1, n % 2 ? 0.3 : -0.3);
for (let n = cue.punches[0]; n < cue.whip; n += 0.25) if (n % 0.5) hat(b(n), 0.35, 0.5);
riser(b(cue.riser), b(cue.whip));
whoosh(b(cue.whip));
bell(b(cue.sun), 659.25, 1, -0.2);
bell(b(cue.sun) + 0.25, 987.77, 0.7, 0.25);
kick(b(cue.sun), 0.9, 80, 38, 0.8);
pad(b(cue.sun), CFG.DURATION_SEC, [220, 277.18, 329.63, 440]);
bell(b(cue.logo), 880, 0.9, -0.15);
bell(b(cue.logoHead), 1318.5, 0.8, 0.15);
kick(b(cue.logoHead), 0.6, 90, 40, 0.5);

// ---------- master: soft clip, normalise to -1 dBFS, write ----------
let peak = 0;
for (let i = 0; i < N; i++) { L[i] = Math.tanh(L[i] * 1.2); R[i] = Math.tanh(R[i] * 1.2); peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i])); }
const g = 0.89 / (peak || 1);
const out = Buffer.alloc(44 + N * 4);
out.write("RIFF", 0); out.writeUInt32LE(36 + N * 4, 4); out.write("WAVE", 8);
out.write("fmt ", 12); out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20); out.writeUInt16LE(2, 22);
out.writeUInt32LE(SR, 24); out.writeUInt32LE(SR * 4, 28); out.writeUInt16LE(4, 32); out.writeUInt16LE(16, 34);
out.write("data", 36); out.writeUInt32LE(N * 4, 40);
for (let i = 0; i < N; i++) {
  out.writeInt16LE(Math.round(Math.max(-1, Math.min(1, L[i] * g)) * 32767), 44 + i * 4);
  out.writeInt16LE(Math.round(Math.max(-1, Math.min(1, R[i] * g)) * 32767), 46 + i * 4);
}
const file = join(root, "assets/audio/score.wav");
mkdirSync(dirname(file), { recursive: true });
writeFileSync(file, out);
console.log(`wrote ${file} (${CFG.DURATION_SEC}s, peak gain ${g.toFixed(2)})`);
