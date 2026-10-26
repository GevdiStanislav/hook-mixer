import { FFmpeg } from './vendor/ffmpeg/index.js';
import { mountSettings, getCfg } from './settings.js';
import { renderSegment, renderAll, assemble, loadFont, previewFrame, dims, cutSilence, exportExtras, encodeWebm, resetRenderCache, setThreading } from './render.js';
import { makeZip } from './zip.js';
import { transcribe, extractAudio, wordsFromChunks, groupCaptions, buildAss, buildSrt } from './captions.js';

const $ = (s) => document.querySelector(s);
const DRIVE = 'https://www.googleapis.com/drive/v3/files';
const FIELDS = ['apiKey', 'mainFolder', 'manualHooks', 'count', 'batch', 'hookMode', 'maxSec', 'hookSec', 'pickMode'];
// головна папка Junction на Google Drive (можна змінити на сайті)
const DEFAULT_MAIN_FOLDER = 'https://drive.google.com/drive/folders/1yoCiuF8Mm6rOSPf482WToMDBtfQIludH';

let mode = 'drive';
// clips = video/photo hooks, texts = text hooks, videos = main videos, srts = subtitles by base name
const pool = { clips: [], texts: [], videos: [], music: [], logos: [], luts: [], srts: new Map() };
const local = { music: null, logo: null, lut: null };
const cache = new Map();
let ffmpeg = null;
let logLines = [];
let lastSource = null;

// ---------- settings of the source block (stored only in this browser) ----------
function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem('hookmixer') || '{}');
    FIELDS.forEach((f) => { if (s[f] !== undefined) $('#' + f).value = s[f]; });
  } catch (e) { /* storage unavailable */ }
}
function saveSettings() {
  try {
    const s = {};
    FIELDS.forEach((f) => { s[f] = $('#' + f).value; });
    localStorage.setItem('hookmixer', JSON.stringify(s));
  } catch (e) { /* storage unavailable */ }
}
FIELDS.forEach((f) => $('#' + f).addEventListener('change', saveSettings));
loadSettings();
if (!$('#mainFolder').value.trim()) $('#mainFolder').value = DEFAULT_MAIN_FOLDER;
mountSettings($('#settings'));

// ---------- UI helpers ----------
function status(msg, isErr = false) {
  const el = $('#status');
  el.textContent = msg;
  el.classList.toggle('err', isErr);
}
function progress(p) {
  $('.progress').hidden = p === null;
  if (p !== null) $('#bar').style.width = Math.round(Math.max(0, Math.min(1, p)) * 100) + '%';
}
function log(line) {
  logLines.push(line);
  if (logLines.length > 600) logLines = logLines.slice(-600);
  $('#log').textContent = logLines.slice(-300).join('\n');
}
const manualHooks = () => $('#manualHooks').value.split('\n').map((s) => s.trim()).filter(Boolean);
function updatePoolInfo() {
  const extra = [];
  if (pool.music.length || local.music) extra.push(`Музика: ${local.music ? local.music.name : pool.music.length + ' трек(и)'}`);
  if (pool.srts.size) extra.push(`Субтитри: ${pool.srts.size}`);
  if (pool.logos.length || local.logo) extra.push('Логотип: є');
  if (pool.luts.length || local.lut) extra.push('LUT: ' + (local.lut ? local.lut.name : pool.luts[0].name));
  $('#pool').textContent =
    `Відео-хуків: ${pool.clips.length} · Текстових хуків: ${pool.texts.length + manualHooks().length} · Основних відео: ${pool.videos.length}` +
    (extra.length ? ' · ' + extra.join(' · ') : '');
}
$('#manualHooks').addEventListener('input', updatePoolInfo);

document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => {
  document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x === t));
  mode = t.dataset.mode;
  $('#drive-box').hidden = mode !== 'drive';
  $('#local-box').hidden = mode !== 'local';
  Object.assign(pool, { clips: [], texts: [], videos: [], music: [], logos: [], luts: [], srts: new Map() });
  if (mode === 'local') readLocal();
  updatePoolInfo();
}));

// files chosen inside the settings panel (it re-renders, so listen on the document)
document.addEventListener('change', (e) => {
  if (e.target.id === 'localMusic') { local.music = e.target.files[0] || null; updatePoolInfo(); }
  if (e.target.id === 'localLogo') { local.logo = e.target.files[0] || null; updatePoolInfo(); }
  if (e.target.id === 'localLut') { local.lut = e.target.files[0] || null; updatePoolInfo(); }
});

// ---------- file types ----------
const isVideo = (f) => (f.mimeType || '').startsWith('video/') || /\.(mp4|mov|m4v|webm|mkv)$/i.test(f.name);
const isImage = (f) => (f.mimeType || '').startsWith('image/') || /\.(jpe?g|png|webp)$/i.test(f.name);
const isAudio = (f) => (f.mimeType || '').startsWith('audio/') || /\.(mp3|m4a|wav|aac|ogg)$/i.test(f.name);
const isSrt = (f) => /\.srt$/i.test(f.name);
const isText = (f) => !isSrt(f) && (f.mimeType === 'text/plain' || /\.txt$/i.test(f.name) || f.mimeType === 'application/vnd.google-apps.document');
const baseName = (n) => n.replace(/\.[^.]+$/, '').toLowerCase();
const textLines = (bytes) => new TextDecoder().decode(bytes).split(/\r?\n/).map((s) => s.trim()).filter(Boolean);

// ---------- Google Drive (Apps Script or API key) ----------
function folderId(v) {
  v = v.trim();
  const m = v.match(/folders\/([\w-]+)/) || v.match(/[?&]id=([\w-]+)/);
  return m ? m[1] : v;
}
const isScript = (key) => /^https:\/\/script\.google(usercontent)?\.com\//.test(key);
async function scriptCall(url, params) {
  let r;
  try {
    r = await fetch(url + (url.includes('?') ? '&' : '?') + new URLSearchParams(params));
  } catch (e) {
    throw new Error('Не вдалося звʼязатися зі скриптом. Перевір посилання і що доступ у Web app = «Усі» (Anyone).');
  }
  if (!r.ok) throw new Error(`Скрипт відповів ${r.status}. Перевір, що вебдодаток опублікований з доступом «Усі».`);
  const j = await r.json();
  if (j.error) throw new Error('Помилка скрипта: ' + j.error);
  return j;
}
const FOLDER = 'application/vnd.google-apps.folder';
async function driveChildren(id, key) {
  if (isScript(key)) return (await scriptCall(key, { action: 'list', id })).files || [];
  let files = [];
  let pageToken = '';
  do {
    const q = encodeURIComponent(`'${id}' in parents and trashed=false`);
    const url = `${DRIVE}?q=${q}&key=${key}&pageSize=1000&fields=nextPageToken,files(id,name,mimeType,size)` +
      (pageToken ? `&pageToken=${pageToken}` : '') + '&supportsAllDrives=true&includeItemsFromAllDrives=true';
    const r = await fetch(url);
    if (!r.ok) throw new Error(await driveError(r));
    const j = await r.json();
    files = files.concat(j.files || []);
    pageToken = j.nextPageToken || '';
  } while (pageToken);
  return files;
}
async function driveList(id, key, depth = 0) {
  const out = [];
  for (const f of await driveChildren(id, key)) {
    if (f.mimeType === FOLDER) { if (depth < 2) out.push(...await driveList(f.id, key, depth + 1)); } else out.push(f);
  }
  return out;
}
async function driveError(r) {
  let msg = `Google Drive відповів ${r.status}`;
  try { const j = await r.json(); msg += ': ' + (j.error && j.error.message); } catch (e) { /* ignore */ }
  if (r.status === 404) msg += ' — перевір, що папка відкрита «Усім, хто має посилання».';
  if (r.status === 403) msg += ' — перевір API-ключ, чи увімкнено Google Drive API і обмеження ключа.';
  return msg;
}
async function driveBytes(file, key) {
  if (isScript(key)) {
    const decode = (b64) => { const bin = atob(b64); const a = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); return a; };
    const first = await scriptCall(key, { action: 'file', id: file.id, start: 0 });
    if (first.text !== undefined) return new TextEncoder().encode(first.text);
    const head = decode(first.base64);
    if (first.size === undefined || head.length >= first.size) return head; // small file or old script version
    // big file: the script sends it in 8 MB pieces
    const size = first.size;
    const out = new Uint8Array(size);
    out.set(head, 0);
    const starts = [];
    for (let s = head.length; s < size; s += head.length) starts.push(s);
    let done = head.length;
    const show = () => status(`Завантажую «${file.name}» з Drive: ${Math.round((done / size) * 100)}% (${(size / 1048576).toFixed(0)} МБ)`);
    show();
    const worker = async () => {
      while (starts.length) {
        const s = starts.shift();
        const part = decode((await scriptCall(key, { action: 'file', id: file.id, start: s })).base64);
        out.set(part, s);
        done += part.length;
        show();
      }
    };
    // 6 pieces at a time: Apps Script answers each call slowly, so parallel calls are much faster
    await Promise.all([worker(), worker(), worker(), worker(), worker(), worker()]);
    return out;
  }
  const url = file.mimeType === 'application/vnd.google-apps.document'
    ? `${DRIVE}/${file.id}/export?mimeType=text/plain&key=${key}`
    : `${DRIVE}/${file.id}?alt=media&key=${key}&supportsAllDrives=true`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(await driveError(r));
  return new Uint8Array(await r.arrayBuffer());
}
function cached(id, loader) {
  if (!cache.has(id)) cache.set(id, loader().catch((e) => { cache.delete(id); throw e; }));
  return cache.get(id);
}
// Drive files are also kept in the browser's cache, so the next visit doesn't download them again
const FILE_CACHE = 'hook-mixer-files-v1';
async function persistentGet(key, loader) {
  let store = null;
  try { store = await caches.open(FILE_CACHE); } catch (e) { return loader(); }
  const url = '/__files/' + encodeURIComponent(key);
  try {
    const hit = await store.match(url);
    if (hit) return new Uint8Array(await hit.arrayBuffer());
  } catch (e) { /* cache unavailable */ }
  const bytes = await loader();
  try { await store.put(url, new Response(bytes.slice())); } catch (e) { /* quota full: just don't cache */ }
  return bytes;
}
const driveItem = (f, key) => ({ name: f.name, get: () => cached(f.id, () => persistentGet(`${f.id}:${f.size || ''}`, () => driveBytes(f, key))) });
$('#clearCache').addEventListener('click', async () => {
  try { await caches.delete(FILE_CACHE); } catch (e) { /* ignore */ }
  cache.clear();
  status('Кеш файлів очищено: наступного разу файли завантажаться з Drive заново.');
});

const RE = {
  hooks: /хук|hook/i,
  music: /music|музик|audio|аудіо|sound|звук|трек/i,
  logo: /logo|лого|brand|бренд/i,
  lut: /lut|лут|cube|колір|color/i,
  videos: /відео|видео|video|body|основ|ролик|clip|main/i,
};

async function loadPools(key, hooksId, videosId, musicId) {
  status('Читаю файли на Google Drive…');
  const [hookFiles, videoFiles, musicFiles] = await Promise.all([
    driveList(hooksId, key), driveList(videosId, key), musicId ? driveList(musicId, key) : Promise.resolve([])]);
  pool.clips = hookFiles.filter((f) => isVideo(f) || isImage(f)).map((f) => driveItem(f, key));
  pool.texts = [];
  for (const f of hookFiles.filter(isText)) pool.texts.push(...textLines(await driveBytes(f, key)));
  pool.videos = videoFiles.filter(isVideo).map((f) => driveItem(f, key));
  pool.srts = new Map(videoFiles.filter(isSrt).map((f) => [baseName(f.name), driveItem(f, key)]));
  pool.music = musicFiles.filter(isAudio).map((f) => driveItem(f, key));
}

function finishLoad() {
  updatePoolInfo();
  updatePlanInfo();
  if (!pool.videos.length) status('У папці з відео не знайдено відеофайлів. Перевір вибір папок.', true);
  else if (!pool.clips.length && !pool.texts.length && !manualHooks().length) status('Відео знайдено, але хуків немає. Перевір папку з хуками або впиши хуки вручну.', true);
  else status('Готово. Налаштуй стиль і тисни «Поєднати».');
}

$('#loadDrive').addEventListener('click', async () => {
  saveSettings();
  const key = $('#apiKey').value.trim();
  const mainId = folderId($('#mainFolder').value);
  if (!key || !mainId) return status('Встав посилання на Apps Script (або API-ключ) і посилання на головну папку.', true);
  const btn = $('#loadDrive');
  btn.disabled = true;
  try {
    status('Читаю головну папку…');
    const children = await driveChildren(mainId, key);
    const subs = children.filter((f) => f.mimeType === FOLDER);
    const files = children.filter((f) => f.mimeType !== FOLDER);
    pool.logos = [];
    pool.luts = files.filter((f) => /\.cube$/i.test(f.name)).map((f) => driveItem(f, key));
    if (!subs.length) {
      $('#pickers').hidden = true;
      pool.clips = files.filter((f) => (isVideo(f) || isImage(f)) && RE.hooks.test(f.name)).map((f) => driveItem(f, key));
      pool.videos = files.filter((f) => isVideo(f) && !RE.hooks.test(f.name)).map((f) => driveItem(f, key));
      pool.music = files.filter(isAudio).map((f) => driveItem(f, key));
      pool.srts = new Map(files.filter(isSrt).map((f) => [baseName(f.name), driveItem(f, key)]));
      pool.texts = [];
      for (const f of files.filter(isText)) pool.texts.push(...textLines(await driveBytes(f, key)));
      return finishLoad();
    }
    // subfolders: guess roles by name, the user can change them in the lists
    const used = new Set();
    const pick = (re) => { const f = subs.find((s) => !used.has(s) && re.test(s.name)); if (f) used.add(f); return f; };
    const hooks = pick(RE.hooks);
    const music = pick(RE.music);
    const logo = pick(RE.logo);
    const lut = pick(RE.lut);
    const videos = pick(RE.videos) || subs.find((s) => !used.has(s));
    const opts = subs.map((f) => `<option value="${f.id}">${f.name.replace(/</g, '&lt;')}</option>`).join('');
    $('#hooksPick').innerHTML = opts;
    $('#videosPick').innerHTML = opts;
    $('#musicPick').innerHTML = '<option value="">— немає —</option>' + opts;
    $('#hooksPick').value = (hooks || subs.find((s) => s !== videos) || subs[0]).id;
    $('#videosPick').value = (videos || subs[0]).id;
    $('#musicPick').value = music ? music.id : '';
    $('#pickers').hidden = false;
    if (logo) pool.logos = (await driveList(logo.id, key)).filter(isImage).map((f) => driveItem(f, key));
    if (lut) pool.luts.push(...(await driveList(lut.id, key)).filter((f) => /\.cube$/i.test(f.name)).map((f) => driveItem(f, key)));
    await loadPools(key, $('#hooksPick').value, $('#videosPick').value, $('#musicPick').value);
    finishLoad();
  } catch (e) {
    status(e.message, true);
  } finally { btn.disabled = false; }
});

['#hooksPick', '#videosPick', '#musicPick'].forEach((s) => $(s).addEventListener('change', async () => {
  try {
    await loadPools($('#apiKey').value.trim(), $('#hooksPick').value, $('#videosPick').value, $('#musicPick').value);
    finishLoad();
  } catch (e) { status(e.message, true); }
}));

// ---------- local files ----------
function readLocal() {
  const wrap = (f) => ({ name: f.name, get: () => cached('local:' + f.name + f.size, async () => new Uint8Array(await f.arrayBuffer())) });
  pool.clips = [...$('#localHookClips').files].map(wrap);
  const vids = [...$('#localVideos').files];
  pool.videos = vids.filter((f) => !isSrt(f)).map(wrap);
  pool.srts = new Map(vids.filter(isSrt).map((f) => [baseName(f.name), wrap(f)]));
  pool.texts = [];
  updatePoolInfo();
  updatePlanInfo();
}
$('#localHookClips').addEventListener('change', readLocal);
$('#localVideos').addEventListener('change', readLocal);

// ---------- ffmpeg ----------
// Multi-threaded ffmpeg needs a "cross-origin isolated" page (headers in vercel.json); otherwise the single-threaded one is used.
let MT = typeof SharedArrayBuffer !== 'undefined' && self.crossOriginIsolated === true;
// version in worker URLs: browsers that cached old copies (sent without the isolation headers) would block them
const BUILD = '20261026b';
const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
async function loadCore(kind) {
  const ff = new FFmpeg();
  ff.on('log', ({ message }) => log(message));
  ff.on('progress', ({ progress: p }) => progress(p));
  const base = new URL(kind === 'mt' ? './vendor/core-mt/' : './vendor/core/', import.meta.url).href;
  const opt = {
    coreURL: base + 'ffmpeg-core.js', wasmURL: base + 'ffmpeg-core.wasm',
    classWorkerURL: new URL(`./vendor/ffmpeg/worker.js?v=${BUILD}`, import.meta.url).href,
  };
  if (kind === 'mt') opt.workerURL = base + 'ffmpeg-core.worker.js';
  try {
    await withTimeout(ff.load(opt), 120000);
    return ff;
  } catch (e) {
    ff.terminate();
    throw e;
  }
}
let ffLoading = null;
function getFFmpeg() {
  if (ffmpeg) return Promise.resolve(ffmpeg);
  if (!ffLoading) {
    ffLoading = (async () => {
      let ff = null;
      // multi-threaded first (it has a fixed 1 GB of memory); if the browser refuses it — single-threaded
      if (MT) { try { ff = await loadCore('mt'); } catch (e) { log(`Багатопотоковий ffmpeg не запустився: ${(e && e.message) || e}`); } }
      if (!ff) { MT = false; ff = await loadCore('st'); }
      setThreading(MT);
      resetRenderCache();
      ffmpeg = ff;
      return ff;
    })().finally(() => { ffLoading = null; });
  }
  return ffLoading;
}
// start downloading ffmpeg (≈30 МБ) right away, while the settings are being chosen
setTimeout(() => {
  getFFmpeg().then(() => { if (!$('#status').textContent) status(`ffmpeg готовий${MT ? ' (багатопотоковий режим)' : ''}.`); }).catch(() => { /* retried on «Поєднати» */ });
}, 800);
async function restartFFmpeg() {
  if (ffmpeg) { try { ffmpeg.terminate(); } catch (e) { /* already dead */ } }
  ffmpeg = null;
  return getFFmpeg();
}

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
function pickMany(arr, n, first = null) {
  const copy = arr.filter((x) => x !== first);
  const out = first ? [first] : [];
  while (out.length < n) {
    if (!copy.length) copy.push(...arr); // not enough files → allow repeats
    out.push(copy.splice(Math.floor(Math.random() * copy.length), 1)[0]);
  }
  return out;
}

// ---------- plans: what goes into each roll ----------
function hookItems(hookMode) {
  const texts = [...pool.texts, ...manualHooks()];
  const clips = pool.clips;
  if (hookMode === 'clip') return clips.map((c) => ({ mode: 'clip', clip: c, text: null }));
  if (hookMode === 'text') return texts.map((t) => ({ mode: 'text', clip: null, text: t }));
  if (hookMode === 'both') return texts.length ? clips.map((c) => ({ mode: 'both', clip: c, text: pick(texts) })) : [];
  return [...clips.map((c) => ({ mode: 'clip', clip: c, text: null })), ...texts.map((t) => ({ mode: 'text', clip: null, text: t }))];
}
const MAX_ROLLS = 60;
/** Returns [{ hook, videos, tag }] — one entry per roll. */
function buildPlans() {
  const hookMode = $('#hookMode').value;
  const count = Math.max(1, +$('#count').value || 1);
  const how = $('#pickMode').value;
  const hooks = hookItems(hookMode);
  if (!hooks.length) {
    if (hookMode === 'clip' || hookMode === 'both') throw new Error('Немає відео-хуків у папці.');
    if (hookMode === 'text') throw new Error('Немає текстових хуків (додай .txt / Google Doc у папку або впиши вручну).');
    throw new Error('Немає жодного хука: додай відео-хуки або текстові хуки.');
  }
  const hIndex = (h) => hooks.indexOf(h) + 1;
  const bIndex = (v) => pool.videos.indexOf(v) + 1;
  const pad = (x) => String(x).padStart(2, '0');
  const plans = [];
  if (how === 'matrix') {
    for (const h of hooks) for (const v of pool.videos) plans.push({ hook: h, videos: pickMany(pool.videos, count, v) });
  } else if (how === 'eachHook') {
    for (const h of hooks) plans.push({ hook: h, videos: pickMany(pool.videos, count) });
  } else {
    const total = Math.max(1, +$('#batch').value || 1);
    for (let i = 0; i < total; i++) plans.push({ hook: pick(hooks), videos: pickMany(pool.videos, count) });
  }
  plans.forEach((p) => { p.tag = `H${pad(hIndex(p.hook))}-B${pad(bIndex(p.videos[0]))}`; });
  return plans.slice(0, MAX_ROLLS);
}

function updatePlanInfo() {
  const el = $('#planInfo');
  if (!el) return;
  const how = $('#pickMode').value;
  $('#batchWrap').hidden = how !== 'random';
  if (!pool.videos.length) { el.textContent = ''; return; }
  const n = hookItems($('#hookMode').value).length;
  const rolls = how === 'matrix' ? n * pool.videos.length : how === 'eachHook' ? n : Math.max(1, +$('#batch').value || 1);
  el.textContent = `Буде зроблено роликів: ${Math.min(rolls, MAX_ROLLS)}${rolls > MAX_ROLLS ? ` (з ${rolls}, максимум ${MAX_ROLLS} за раз)` : ''}.`;
}
['#pickMode', '#hookMode', '#batch'].forEach((s) => $(s).addEventListener('change', updatePlanInfo));
$('#manualHooks').addEventListener('input', updatePlanInfo);

const extOf = (name, fallback) => (name.match(/\.\w+$/) || [fallback])[0].toLowerCase();
const slug = (s) => String(s || '').replace(/\.[^.]+$/, '').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 24) || 'x';
let fileN = 0;

/** Jobs (sources in order) for one plan. */
function jobsFor(plan, cfg) {
  const maxSec = Math.max(0, +$('#maxSec').value || 0);
  const hookSec = Math.max(0, +$('#hookSec').value || 0);
  const textSec = +cfg.text.seconds || 3;
  const { hook, videos } = plan;
  const jobs = [];
  if (hook.clip) jobs.push({ src: hook.clip, isHook: true, isLast: false, maxSec: hookSec, text: hook.mode === 'both' ? { content: hook.text, t0: 0, t1: 999 } : null });
  videos.forEach((v, i) => jobs.push({
    src: v, isHook: !hook.clip && i === 0, isLast: i === videos.length - 1, maxSec,
    text: hook.mode === 'text' && i === 0 ? { content: hook.text, t0: 0, t1: textSec } : null,
  }));
  return jobs;
}

/** Downloads a source, cuts pauses, prepares subtitles. Returns the job description for the renderer. */
async function prepareJob(ff, cfg, j, label, transcripts, lut) {
  status(`${label}: завантажую «${j.src.name}»…`);
  const bytes = await j.src.get();
  const id = fileN++;
  let input = `in${id}${extOf(j.src.name, '.mp4')}`;
  await ff.writeFile(input, bytes.slice()); // copy: ffmpeg takes ownership of the buffer, the cache keeps the original
  if (cfg.edit.cutSilence && !j.isHook && !isImage(j.src)) {
    status(`${label}: вирізаю паузи в «${j.src.name}»…`);
    input = await cutSilence(ff, logLines, input, cfg.edit.silenceLevel);
  }
  if (!j.isHook) lastSource = { name: j.src.name, bytes }; // background for the style preview
  let srt = null;
  const srtItem = cfg.subs.source !== 'none' && pool.srts.get(baseName(j.src.name));
  if (srtItem) { srt = `sub${id}.srt`; await ff.writeFile(srt, (await srtItem.get()).slice()); } else if (cfg.subs.source === 'auto' && !isImage(j.src)) {
    const caps = await autoCaptions(ff, input, j, cfg, label);
    if (caps.length) {
      const { W, H } = dims(cfg);
      srt = `sub${id}.ass`;
      await ff.writeFile(srt, buildAss(caps, cfg, W, H));
      transcripts.push({ name: j.src.name, srt: buildSrt(caps) });
    }
  }
  return { input, name: j.src.name, maxSec: j.maxSec, isHook: j.isHook, isLast: j.isLast, text: j.text, srt, lut };
}
async function cleanup(ff, prepared) {
  for (const p of prepared) {
    for (const f of [p.input, p.srt]) if (f) { try { await ff.deleteFile(f); } catch (e) { /* already gone */ } }
  }
}

/**
 * Makes one roll. With segCache (several rolls), every clip is rendered once and reused;
 * a single roll is rendered in one pass (one encode).
 */
async function makeOne(ff, plan, n, total, segCache) {
  const cfg = getCfg();
  const jobs = jobsFor(plan, cfg);
  // multi-threaded ffmpeg has only 1 GB: obviously heavy rolls go clip by clip straight away
  const heavy = MT && !segCache && jobs.length >= 3 && (cfg.edit.boomerang || cfg.fx.leaks || cfg.fx.stabilize || cfg.fx.trails || cfg.fx.motionblur || cfg.format.fit === 'blur' || cfg.format.hd);
  if (heavy) {
    const tmp = new Map();
    const res = await makeOne(ff, plan, n, total, tmp);
    for (const s of tmp.values()) { try { await (ffmpeg || ff).deleteFile(s.output); } catch (e) { /* ignore */ } }
    return res;
  }
  await loadFont(ff, cfg);
  const transcripts = [];
  let lut = null;
  if (cfg.fx.grade === 'lut') {
    const l = local.lut ? { name: local.lut.name, get: async () => new Uint8Array(await local.lut.arrayBuffer()) } : pool.luts[0];
    if (!l) throw new Error('Обрано «Мій LUT», але файл .cube не знайдено: додай його у вкладці «Ефекти» або в підпапку «lut» на Drive.');
    lut = 'grade.cube';
    await ff.writeFile(lut, (await l.get()).slice());
  }
  const extras = { music: null, logo: null };
  if (cfg.audio.music && (local.music || pool.music.length)) {
    const m = local.music ? { name: local.music.name, get: async () => new Uint8Array(await local.music.arrayBuffer()) } : pick(pool.music);
    extras.music = 'music' + extOf(m.name, '.mp3');
    extras.musicName = m.name;
    await ff.writeFile(extras.music, (await m.get()).slice());
  }
  if (cfg.logo.enabled && (local.logo || pool.logos.length)) {
    const l = local.logo ? { name: local.logo.name, get: async () => new Uint8Array(await local.logo.arrayBuffer()) } : pool.logos[0];
    extras.logo = 'logo' + extOf(l.name, '.png');
    await ff.writeFile(extras.logo, (await l.get()).slice());
  }

  const out = `mix${n}.mp4`;
  let length;
  if (segCache) {
    const segs = [];
    for (let i = 0; i < jobs.length; i++) {
      const j = jobs[i];
      const key = JSON.stringify([j.src.name, j.isHook, j.isLast, j.maxSec, j.text && j.text.content]);
      const label = `Ролик ${n}/${total} · кліп ${i + 1}/${jobs.length}`;
      if (!segCache.has(key)) {
        const p = await prepareJob(ff, cfg, j, label, transcripts, lut);
        status(`${label}: монтую «${j.src.name}»…`);
        segCache.set(key, await renderSegment(ff, logLines, cfg, p, `cseg${segCache.size}.mp4`));
        await cleanup(ff, [p]);
      }
      segs.push(segCache.get(key));
    }
    status(`Ролик ${n}/${total}: збираю (переходи, звук, ефекти)…`);
    length = await assemble(ff, logLines, cfg, segs, extras, out);
  } else {
    const prepared = [];
    for (let i = 0; i < jobs.length; i++) prepared.push(await prepareJob(ff, cfg, jobs[i], `Ролик ${n}/${total} · кліп ${i + 1}/${jobs.length}`, transcripts, lut));
    status(`Ролик ${n}/${total}: монтую все за один прохід…`);
    try {
      length = await renderAll(ff, logLines, cfg, prepared, extras, out);
    } catch (e) {
      // too heavy for one pass (usually memory): restart ffmpeg and make this roll clip by clip
      log('Один прохід не вдався (' + (e.message || e) + '), монтую по кліпах.');
      status(`Ролик ${n}/${total}: важкий ролик — монтую по кліпах…`);
      const ff2 = await restartFFmpeg();
      const tmp = new Map();
      const res = await makeOne(ff2, plan, n, total, tmp);
      for (const s of tmp.values()) { try { await ff2.deleteFile(s.output); } catch (err) { /* ignore */ } }
      return res;
    }
    await cleanup(ff, prepared);
  }

  const base = `${plan.tag}_${slug(plan.hook.clip ? plan.hook.clip.name : plan.hook.text)}_${slug(plan.videos[0].name)}`;
  const files = await exportExtras(ff, cfg, out, length, base, (l) => status(`Ролик ${n}/${total}: готую ${l}…`));
  const data = await ff.readFile(out);
  await ff.deleteFile(out);
  if (lut) await ff.deleteFile(lut);
  for (const f of [extras.music, extras.logo]) if (f) { try { await ff.deleteFile(f); } catch (e) { /* ignore */ } }
  if (cfg.export.webm) {
    // free the browser's memory first: close this ffmpeg, the next roll starts a fresh one
    status(`Ролик ${n}/${total}: готую WebM…`);
    ff.terminate();
    ffmpeg = null;
    if (segCache) segCache.clear(); // its files lived in the closed ffmpeg
    const webm = await encodeWebm(data.slice());
    if (webm) files.push({ label: 'WebM', name: `${base}.webm`, blob: webm });
  }
  return { blob: new Blob([data.buffer], { type: 'video/mp4' }), hook: plan.hook, videos: plan.videos, music: extras.musicName, transcripts, files, base, tag: plan.tag, length };
}

// speech → words (cached per file, model, language and length)
const wordCache = new Map();
async function autoCaptions(ff, input, job, cfg, label) {
  const key = [job.src.name, cfg.subs.model, cfg.subs.lang, job.maxSec].join('|');
  if (!wordCache.has(key)) {
    status(`${label}: витягую звук для субтитрів…`);
    const audio = await extractAudio(ff, input, job.maxSec);
    if (!audio || audio.length < 16000 * 0.3) { wordCache.set(key, []); return []; }
    const res = await transcribe(audio, { model: cfg.subs.model, language: cfg.subs.lang }, (p) => {
      if (p.type === 'loading') status(`Завантажую модель розпізнавання мови: ${Math.round((p.loaded / p.total) * 100)}% (${(p.total / 1048576).toFixed(0)} МБ, тільки перший раз)`);
      if (p.type === 'working') status(`${label}: розпізнаю мову в «${job.src.name}»…`);
    });
    wordCache.set(key, wordsFromChunks(res.chunks));
  }
  const words = wordCache.get(key);
  const { W, H } = dims(cfg);
  const fs = Math.min(W, H) * ({ s: 0.055, m: 0.07, l: 0.09 }[cfg.subs.size || 'm']);
  return groupCaptions(words, +cfg.subs.words || 3, Math.max(8, Math.floor((W * 0.86) / (fs * 0.62))));
}

let made = []; // results of the current batch, for the ZIP
function showResult({ blob, hook, videos, music, transcripts = [], files = [], base, tag, length }) {
  const url = URL.createObjectURL(blob);
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const el = document.createElement('div');
  el.className = 'card result';
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  el.innerHTML = `
    <video src="${url}" controls playsinline></video>
    <div>
      <b>${esc(tag || 'Готово')} · ${(length || 0).toFixed(1)} с · ${(blob.size / 1048576).toFixed(1)} МБ</b>
      <ul>
        ${hook.clip ? `<li>Відео-хук: ${esc(hook.clip.name)}</li>` : ''}
        ${hook.text ? `<li>Текстовий хук: «${esc(hook.text)}»</li>` : ''}
        ${videos.map((v) => `<li>Відео: ${esc(v.name)}</li>`).join('')}
        ${music ? `<li>Музика: ${esc(music)}</li>` : ''}
      </ul>
      ${files.map((f) => `<a class="dl" href="${URL.createObjectURL(f.blob)}" download="${esc(f.name)}">⬇ ${esc(f.label)} · ${(f.blob.size / 1048576).toFixed(1)} МБ</a><br>`).join('')}
      ${transcripts.map((t) => `<a class="dl" href="${URL.createObjectURL(new Blob([t.srt], { type: 'text/plain' }))}" download="${esc(t.name.replace(/\.[^.]+$/, ''))}.srt">⬇ Субтитри ${esc(t.name)} (.srt)</a><br>`).join('')}
      <a class="btn" href="${url}" download="${base || 'junction_mix_' + stamp}.mp4">Завантажити MP4</a>
    </div>`;
  $('#results').prepend(el);
  made.push({ base, blob, files, transcripts, hook, videos, music, tag, length });
}

$('#mix').addEventListener('click', async () => {
  saveSettings();
  if (mode === 'local') readLocal();
  if (!pool.videos.length) {
    return status(mode === 'drive' ? 'Спершу натисни «Завантажити список файлів».' : 'Обери основні відео.', true);
  }
  const btn = $('#mix');
  btn.disabled = true;
  made = [];
  $('#zipBox').hidden = true;
  const started = performance.now();
  try {
    const plans = buildPlans();
    const total = plans.length;
    prefetch(plans);
    const segCache = total > 1 ? new Map() : null;
    if (!ffmpeg) status(`Завантажую ffmpeg${MT ? ' (багатопотоковий)' : ''}… Перший раз це до хвилини, далі миттєво.`);
    await getFFmpeg();
    for (let n = 1; n <= total; n++) {
      progress(0);
      showResult(await makeOne(await getFFmpeg(), plans[n - 1], n, total, segCache));
    }
    if (segCache && ffmpeg) for (const s of segCache.values()) { try { await ffmpeg.deleteFile(s.output); } catch (e) { /* ignore */ } }
    const secs = Math.round((performance.now() - started) / 1000);
    status(`${total > 1 ? `Готово: ${total} роликів` : 'Готово!'} За ${secs} с${MT ? ' (багатопотоковий режим)' : ''}.`);
    if (total > 1) $('#zipBox').hidden = false;
  } catch (e) {
    console.error(e);
    status(e.message || String(e), true);
    if (made.length > 1) $('#zipBox').hidden = false;
  } finally {
    btn.disabled = false;
    progress(null);
  }
});

// start downloading every file the batch needs in the background, while the first roll is being made
function prefetch(plans) {
  const items = [];
  for (const p of plans) for (const it of [p.hook.clip, ...p.videos]) if (it && !items.includes(it)) items.push(it);
  (async () => { for (const it of items) { try { await it.get(); } catch (e) { /* the roll itself will report it */ } } })();
}

$('#zipBtn').addEventListener('click', async () => {
  const btn = $('#zipBtn');
  btn.disabled = true;
  try {
    status('Пакую ZIP…');
    const entries = [];
    const rows = [['file', 'tag', 'hook_clip', 'hook_text', 'videos', 'music', 'seconds']];
    for (const m of made) {
      entries.push({ name: `${m.base}.mp4`, data: new Uint8Array(await m.blob.arrayBuffer()) });
      for (const f of m.files) entries.push({ name: f.name, data: new Uint8Array(await f.blob.arrayBuffer()) });
      for (const t of m.transcripts) entries.push({ name: `${m.base}_${t.name.replace(/\.[^.]+$/, '')}.srt`, data: new TextEncoder().encode(t.srt) });
      rows.push([`${m.base}.mp4`, m.tag, m.hook.clip ? m.hook.clip.name : '', m.hook.text || '', m.videos.map((v) => v.name).join(' + '), m.music || '', (m.length || 0).toFixed(1)]);
    }
    // a table of what is in every roll, handy for naming ads and tracking test results
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    entries.push({ name: 'rolls.csv', data: new TextEncoder().encode('\ufeff' + csv) });
    const zip = makeZip(entries);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(zip);
    a.download = `hook-mixer_${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.zip`;
    a.click();
    status(`ZIP готовий: ${made.length} роликів, ${(zip.size / 1048576).toFixed(0)} МБ.`);
  } catch (e) {
    status('Не вдалося зібрати ZIP: ' + (e.message || e), true);
  } finally { btn.disabled = false; }
});

$('#previewBtn').addEventListener('click', async () => {
  const btn = $('#previewBtn');
  btn.disabled = true;
  try {
    const ff = await getFFmpeg();
    status('Роблю превʼю…');
    const sample = manualHooks()[0] || pool.texts[0] || 'Ти досі не можеш говорити англійською?';
    // use a video that is already downloaded, otherwise a neutral background
    let sourceFile = null;
    let sourceName = null;
    const src = lastSource || (mode === 'local' && pool.videos[0] ? { name: pool.videos[0].name, bytes: await pool.videos[0].get() } : null);
    if (src) {
      sourceName = src.name;
      sourceFile = 'prev' + extOf(sourceName, '.mp4');
      await ff.writeFile(sourceFile, src.bytes.slice());
    }
    let lut = null;
    const cfgNow = getCfg();
    if (cfgNow.fx.grade === 'lut' && (local.lut || pool.luts[0])) {
      const l = local.lut ? { get: async () => new Uint8Array(await local.lut.arrayBuffer()) } : pool.luts[0];
      lut = 'grade.cube';
      await ff.writeFile(lut, (await l.get()).slice());
    }
    const blob = await previewFrame(ff, logLines, cfgNow, { sample, sourceFile, sourceName, lut });
    if (sourceFile) await ff.deleteFile(sourceFile);
    const img = $('#previewImg');
    img.src = URL.createObjectURL(blob);
    img.hidden = false;
    status('Превʼю готове.');
  } catch (e) {
    status(e.message || String(e), true);
  } finally { btn.disabled = false; progress(null); }
});

updatePoolInfo();
updatePlanInfo();
