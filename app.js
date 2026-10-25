import { FFmpeg } from './vendor/ffmpeg/index.js';
import { mountSettings, getCfg } from './settings.js';
import { renderSegment, assemble, loadFont, previewFrame, dims } from './render.js';
import { transcribe, extractAudio, wordsFromChunks, groupCaptions, buildAss, buildSrt } from './captions.js';

const $ = (s) => document.querySelector(s);
const DRIVE = 'https://www.googleapis.com/drive/v3/files';
const FIELDS = ['apiKey', 'mainFolder', 'manualHooks', 'count', 'batch', 'hookMode', 'maxSec', 'hookSec'];
// головна папка Junction на Google Drive (можна змінити на сайті)
const DEFAULT_MAIN_FOLDER = 'https://drive.google.com/drive/folders/1yoCiuF8Mm6rOSPf482WToMDBtfQIludH';

let mode = 'drive';
// clips = video/photo hooks, texts = text hooks, videos = main videos, srts = subtitles by base name
const pool = { clips: [], texts: [], videos: [], music: [], logos: [], srts: new Map() };
const local = { music: null, logo: null };
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
  Object.assign(pool, { clips: [], texts: [], videos: [], music: [], logos: [], srts: new Map() });
  if (mode === 'local') readLocal();
  updatePoolInfo();
}));

// files chosen inside the settings panel (it re-renders, so listen on the document)
document.addEventListener('change', (e) => {
  if (e.target.id === 'localMusic') { local.music = e.target.files[0] || null; updatePoolInfo(); }
  if (e.target.id === 'localLogo') { local.logo = e.target.files[0] || null; updatePoolInfo(); }
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
    // big file: the script sends it in 8 MB pieces, fetch the rest 3 at a time
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
    await Promise.all([worker(), worker(), worker()]);
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
const driveItem = (f, key) => ({ name: f.name, get: () => cached(f.id, () => driveBytes(f, key)) });

const RE = {
  hooks: /хук|hook/i,
  music: /music|музик|audio|аудіо|sound|звук|трек/i,
  logo: /logo|лого|brand|бренд/i,
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
}
$('#localHookClips').addEventListener('change', readLocal);
$('#localVideos').addEventListener('change', readLocal);

// ---------- ffmpeg ----------
async function getFFmpeg() {
  if (ffmpeg) return ffmpeg;
  status('Завантажую ffmpeg (≈30 МБ, тільки перший раз)…');
  const ff = new FFmpeg();
  ff.on('log', ({ message }) => log(message));
  ff.on('progress', ({ progress: p }) => progress(p));
  const base = new URL('./vendor/core/', import.meta.url).href;
  await ff.load({ coreURL: base + 'ffmpeg-core.js', wasmURL: base + 'ffmpeg-core.wasm' });
  ffmpeg = ff;
  return ff;
}

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
function pickMany(arr, n) {
  const copy = [...arr];
  const out = [];
  while (out.length < n) {
    if (!copy.length) copy.push(...arr); // not enough files → allow repeats
    out.push(copy.splice(Math.floor(Math.random() * copy.length), 1)[0]);
  }
  return out;
}

function chooseHook(hookMode) {
  const texts = [...pool.texts, ...manualHooks()];
  const clips = pool.clips;
  let m = hookMode;
  if (m === 'auto') {
    if (!clips.length && !texts.length) throw new Error('Немає жодного хука: додай відео-хуки або текстові хуки.');
    m = Math.random() < clips.length / (clips.length + texts.length) ? 'clip' : 'text';
  }
  if ((m === 'clip' || m === 'both') && !clips.length) throw new Error('Немає відео-хуків у папці.');
  if ((m === 'text' || m === 'both') && !texts.length) throw new Error('Немає текстових хуків (додай .txt / Google Doc у папку або впиши вручну).');
  return { mode: m, clip: m === 'clip' || m === 'both' ? pick(clips) : null, text: m === 'text' || m === 'both' ? pick(texts) : null };
}

const extOf = (name, fallback) => (name.match(/\.\w+$/) || [fallback])[0].toLowerCase();

async function makeOne(ff, n, total) {
  const cfg = getCfg();
  const count = Math.max(1, +$('#count').value || 1);
  const maxSec = Math.max(0, +$('#maxSec').value || 0);
  const hookSec = Math.max(0, +$('#hookSec').value || 0);
  const hook = chooseHook($('#hookMode').value);
  const videos = pickMany(pool.videos, count);
  const textSec = +cfg.text.seconds || 3;

  const jobs = [];
  if (hook.clip) jobs.push({ src: hook.clip, isHook: true, maxSec: hookSec, text: hook.mode === 'both' ? { content: hook.text, t0: 0, t1: 999 } : null });
  videos.forEach((v, i) => jobs.push({
    src: v, isHook: !hook.clip && i === 0, maxSec,
    text: hook.mode === 'text' && i === 0 ? { content: hook.text, t0: 0, t1: textSec } : null,
  }));

  await loadFont(ff, cfg);
  const segs = [];
  const transcripts = [];
  for (let i = 0; i < jobs.length; i++) {
    const j = jobs[i];
    const label = `Ролик ${n}/${total} · крок ${i + 1}/${jobs.length + 1}`;
    status(`${label}: завантажую «${j.src.name}»…`);
    const bytes = await j.src.get();
    const input = `in${i}${extOf(j.src.name, '.mp4')}`;
    await ff.writeFile(input, bytes.slice()); // copy: ffmpeg takes ownership of the buffer, the cache keeps the original
    if (!j.isHook || !hook.clip) lastSource = { name: j.src.name, bytes }; // background for the style preview
    let srt = null;
    const srtItem = cfg.subs.source !== 'none' && pool.srts.get(baseName(j.src.name));
    if (srtItem) { srt = `sub${i}.srt`; await ff.writeFile(srt, (await srtItem.get()).slice()); } else if (cfg.subs.source === 'auto' && !isImage(j.src)) {
      const caps = await autoCaptions(ff, input, j, cfg, label);
      if (caps.length) {
        const { W, H } = dims(cfg);
        srt = `sub${i}.ass`;
        await ff.writeFile(srt, buildAss(caps, cfg, W, H));
        transcripts.push({ name: j.src.name, srt: buildSrt(caps) });
      }
    }
    status(`${label}: монтую «${j.src.name}»…`);
    segs.push(await renderSegment(ff, logLines, cfg, { input, name: j.src.name, maxSec: j.maxSec, isHook: j.isHook, text: j.text, srt }, `seg${i}.mp4`));
    await ff.deleteFile(input);
    if (srt) await ff.deleteFile(srt);
  }

  status(`Ролик ${n}/${total}: збираю фінальне відео (переходи, звук, ефекти)…`);
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
  await assemble(ff, logLines, cfg, segs, extras, out);
  const data = await ff.readFile(out);
  for (const s of segs) await ff.deleteFile(s.output);
  await ff.deleteFile(out);
  return { blob: new Blob([data.buffer], { type: 'video/mp4' }), hook, videos, music: extras.musicName, transcripts };
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

function showResult({ blob, hook, videos, music, transcripts = [] }) {
  const url = URL.createObjectURL(blob);
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const el = document.createElement('div');
  el.className = 'card result';
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  el.innerHTML = `
    <video src="${url}" controls playsinline></video>
    <div>
      <b>Готово · ${(blob.size / 1048576).toFixed(1)} МБ</b>
      <ul>
        ${hook.clip ? `<li>Відео-хук: ${esc(hook.clip.name)}</li>` : ''}
        ${hook.text ? `<li>Текстовий хук: «${esc(hook.text)}»</li>` : ''}
        ${videos.map((v) => `<li>Відео: ${esc(v.name)}</li>`).join('')}
        ${music ? `<li>Музика: ${esc(music)}</li>` : ''}
      </ul>
      ${transcripts.map((t) => `<a class="dl" href="${URL.createObjectURL(new Blob([t.srt], { type: 'text/plain' }))}" download="${esc(t.name.replace(/\.[^.]+$/, ''))}.srt">⬇ Субтитри ${esc(t.name)} (.srt)</a><br>`).join('')}
      <a class="btn" href="${url}" download="junction_mix_${stamp}.mp4">Завантажити MP4</a>
    </div>`;
  $('#results').prepend(el);
}

$('#mix').addEventListener('click', async () => {
  saveSettings();
  if (mode === 'local') readLocal();
  if (!pool.videos.length) {
    return status(mode === 'drive' ? 'Спершу натисни «Завантажити список файлів».' : 'Обери основні відео.', true);
  }
  const btn = $('#mix');
  btn.disabled = true;
  const total = Math.max(1, +$('#batch').value || 1);
  try {
    const ff = await getFFmpeg();
    for (let n = 1; n <= total; n++) {
      progress(0);
      showResult(await makeOne(ff, n, total));
    }
    status(total > 1 ? `Готово: ${total} ролики.` : 'Готово!');
  } catch (e) {
    console.error(e);
    status(e.message || String(e), true);
  } finally {
    btn.disabled = false;
    progress(null);
  }
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
    const blob = await previewFrame(ff, logLines, getCfg(), { sample, sourceFile, sourceName });
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
