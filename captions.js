// Автосубтитри: розпізнавання мови + перетворення тексту на субтитри ASS з підсвіткою слова, яке звучить.
import { FONTS } from './catalog.js';

let worker = null;
let nextId = 1;
const waiting = new Map();

function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('./asr-worker.js?v=20261026b', import.meta.url), { type: 'module' });
  worker.onmessage = ({ data }) => {
    const w = waiting.get(data.id);
    if (!w) return;
    if (data.type === 'done') { waiting.delete(data.id); w.resolve(data); } else if (data.type === 'error') { waiting.delete(data.id); w.reject(new Error(data.message)); } else w.onProgress(data);
  };
  worker.onerror = (e) => { for (const w of waiting.values()) w.reject(new Error('Помилка розпізнавання: ' + (e.message || 'worker'))); waiting.clear(); worker = null; };
  return worker;
}

/** audio: Float32Array, 16 kHz mono. Returns { text, chunks: [{timestamp:[s,e], text}] } */
export function transcribe(audio, { model, language }, onProgress = () => {}) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    waiting.set(id, { resolve, reject, onProgress });
    getWorker().postMessage({ id, audio, model, language }, [audio.buffer]);
  });
}

/** Extracts the first `seconds` of audio from a file already written to the ffmpeg FS. */
export async function extractAudio(ff, input, seconds) {
  const args = ['-hide_banner', '-y'];
  if (seconds > 0) args.push('-t', String(seconds));
  args.push('-i', input, '-vn', '-ac', '1', '-ar', '16000', '-f', 'f32le', 'asr.raw');
  const code = await ff.exec(args);
  if (code !== 0) return null;
  const raw = await ff.readFile('asr.raw');
  await ff.deleteFile('asr.raw');
  if (!raw.length) return null;
  return new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
}

/** Spreads each chunk's time over its words, proportional to word length. */
export function wordsFromChunks(chunks, limit = Infinity) {
  const words = [];
  for (const c of chunks) {
    const [s, eRaw] = c.timestamp || [];
    if (s == null) continue;
    const e = eRaw == null ? s + 2 : eRaw;
    const list = String(c.text || '').trim().split(/\s+/).filter(Boolean);
    if (!list.length) continue;
    const weight = list.map((w) => w.length + 2);
    const total = weight.reduce((a, b) => a + b, 0);
    let t = s;
    list.forEach((w, i) => {
      const d = ((e - s) * weight[i]) / total;
      if (t < limit) words.push({ text: w, start: t, end: Math.min(t + d, limit) });
      t += d;
    });
  }
  return words;
}

/** Groups words into short captions: up to maxWords and ~maxChars, breaking after punctuation. */
export function groupCaptions(words, maxWords = 3, maxChars = 18) {
  const caps = [];
  let cur = [];
  const flush = () => { if (cur.length) caps.push({ words: cur, start: cur[0].start, end: cur[cur.length - 1].end }); cur = []; };
  for (const w of words) {
    const len = cur.reduce((s, x) => s + x.text.length + 1, 0) + w.text.length;
    if (cur.length && (cur.length >= maxWords || len > maxChars || w.start - cur[cur.length - 1].end > 0.6)) flush();
    cur.push(w);
    if (/[.!?…,;:]$/.test(w.text)) flush();
  }
  flush();
  // close tiny gaps so captions don't flicker
  for (let i = 0; i < caps.length - 1; i++) if (caps[i + 1].start - caps[i].end < 0.25) caps[i].end = caps[i + 1].start;
  return caps;
}

const assTime = (t) => {
  t = Math.max(0, t);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = Math.floor(t % 60);
  const cs = Math.floor((t * 100) % 100);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
};
const assColor = (c, alpha = '00') => { const h = String(c || '#FFFFFF').replace('#', ''); return `&H${alpha}${h.slice(4, 6)}${h.slice(2, 4)}${h.slice(0, 2)}`; };
const clean = (s) => s.replace(/[{}\\]/g, '');

/** Builds an .ass subtitle file in the chosen style. */
export function buildAss(caps, cfg, W, H) {
  const s = cfg.subs;
  const font = 'HM ' + (FONTS.find((f) => f.id === cfg.font) || FONTS[0]).file.replace('.ttf', '').replace(/^./, (c) => c.toUpperCase());
  const FS = Math.round(Math.min(W, H) * ({ s: 0.055, m: 0.07, l: 0.09 }[s.size || 'm']));
  const box = cfg.text.boxColor || '#000000';
  let border = '1';
  let outline = Math.max(2, Math.round(FS * 0.09));
  let shadow = 0;
  let outlineColour = '&H00000000';
  let backColour = '&H64000000';
  if (s.style === 'box') { border = '3'; outline = Math.round(FS * 0.22); outlineColour = assColor(box, '10'); backColour = assColor(box, '10'); }
  if (s.style === 'shadow') { outline = 0; shadow = Math.max(2, Math.round(FS * 0.06)); backColour = '&H50000000'; }
  if (s.style === 'plain') { outline = 0; shadow = 0; }
  const align = s.position === 'center' ? 5 : 2;
  const marginV = s.position === 'center' ? 0 : Math.round(H * 0.17);
  const upper = cfg.text.upper;
  const hl = s.highlight && s.highlight !== 'none' ? assColor(s.highlight) : null;
  const lines = [
    '[Script Info]', 'ScriptType: v4.00+', `PlayResX: ${W}`, `PlayResY: ${H}`, 'WrapStyle: 0', 'ScaledBorderAndShadow: yes', '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Default,${font},${FS},${assColor(s.color)},&H000000FF,${outlineColour},${backColour},0,0,0,0,100,100,0,0,${border},${outline},${shadow},${align},${Math.round(W * 0.06)},${Math.round(W * 0.06)},${marginV},1`,
    '', '[Events]', 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];
  const pop = '{\\fscx75\\fscy75\\t(0,110,\\fscx100\\fscy100)}';
  for (const c of caps) {
    const words = c.words.map((w) => clean(upper ? w.text.toUpperCase() : w.text));
    if (!hl) {
      lines.push(`Dialogue: 0,${assTime(c.start)},${assTime(c.end)},Default,,0,0,0,,${pop}${words.join(' ')}`);
      continue;
    }
    // one event per word: the word that is being said gets the highlight colour
    c.words.forEach((w, i) => {
      const a = i === 0 ? c.start : w.start;
      const b = i === c.words.length - 1 ? c.end : c.words[i + 1].start;
      const text = words.map((t, k) => (k === i ? `{\\c${hl}}${t}{\\c${assColor(s.color)}}` : t)).join(' ');
      lines.push(`Dialogue: 0,${assTime(a)},${assTime(b)},Default,,0,0,0,,${i === 0 ? pop : ''}${text}`);
    });
  }
  return lines.join('\n') + '\n';
}

/** Plain .srt so the user can fix the text and put it next to the video on Drive. */
export function buildSrt(caps) {
  const t = (x) => assTime(x).replace(/^(\d+):/, (m, h) => h.padStart(2, '0') + ':').replace('.', ',') + '0';
  return caps.map((c, i) => `${i + 1}\n${t(c.start)} --> ${t(c.end)}\n${c.words.map((w) => w.text).join(' ')}\n`).join('\n');
}
