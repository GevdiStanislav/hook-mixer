import { FFmpeg } from './vendor/ffmpeg/index.js';

const $ = (s) => document.querySelector(s);
const DRIVE = 'https://www.googleapis.com/drive/v3/files';
const FIELDS = ['apiKey', 'mainFolder', 'manualHooks', 'count', 'batch', 'hookMode', 'quality', 'maxSec'];
// головна папка Junction на Google Drive (можна змінити на сайті)
const DEFAULT_MAIN_FOLDER = 'https://drive.google.com/drive/folders/1yoCiuF8Mm6rOSPf482WToMDBtfQIludH';

let mode = 'drive';
// pool: hook clips, text hooks from files, main videos
const pool = { clips: [], texts: [], videos: [] };
const cache = new Map();
let ffmpeg = null;
let logLines = [];

// ---------- settings (stored only in this browser) ----------
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
  if (logLines.length > 400) logLines = logLines.slice(-400);
  $('#log').textContent = logLines.join('\n');
}
function updatePoolInfo() {
  const manual = manualHooks().length;
  $('#pool').textContent =
    `Відео-хуків: ${pool.clips.length} · Текстових хуків: ${pool.texts.length + manual} · Основних відео: ${pool.videos.length}`;
}
const manualHooks = () => $('#manualHooks').value.split('\n').map((s) => s.trim()).filter(Boolean);
$('#manualHooks').addEventListener('input', updatePoolInfo);

document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => {
  document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x === t));
  mode = t.dataset.mode;
  $('#drive-box').hidden = mode !== 'drive';
  $('#local-box').hidden = mode !== 'local';
  pool.clips = []; pool.texts = []; pool.videos = [];
  if (mode === 'local') readLocal();
  updatePoolInfo();
}));

// ---------- Google Drive ----------
function folderId(v) {
  v = v.trim();
  const m = v.match(/folders\/([\w-]+)/) || v.match(/[?&]id=([\w-]+)/);
  return m ? m[1] : v;
}
const FOLDER = 'application/vnd.google-apps.folder';
// "key" is either a Google API key or a link to the Apps Script web app
const isScript = (key) => /^https:\/\/script\.google(usercontent)?\.com\//.test(key);
async function scriptCall(url, params) {
  let r;
  try {
    r = await fetch(url + (url.includes('?') ? '&' : '?') + new URLSearchParams(params));
  } catch (e) {
    throw new Error('Не вдалося звʼязатися зі скриптом. Перевір посилання і що доступ у Web app = «Anyone».');
  }
  if (!r.ok) throw new Error(`Скрипт відповів ${r.status}. Перевір, що Web app опублікований з доступом «Anyone».`);
  const j = await r.json();
  if (j.error) throw new Error('Помилка скрипта: ' + j.error);
  return j;
}

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
// all files inside a folder, also one-two levels of subfolders
async function driveList(id, key, depth = 0) {
  const out = [];
  for (const f of await driveChildren(id, key)) {
    if (f.mimeType === FOLDER) {
      if (depth < 2) out.push(...await driveList(f.id, key, depth + 1));
    } else out.push(f);
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
    const j = await scriptCall(key, { action: 'file', id: file.id });
    if (j.text !== undefined) return new TextEncoder().encode(j.text);
    const bin = atob(j.base64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  const url = file.mimeType === 'application/vnd.google-apps.document'
    ? `${DRIVE}/${file.id}/export?mimeType=text/plain&key=${key}`
    : `${DRIVE}/${file.id}?alt=media&key=${key}&supportsAllDrives=true`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(await driveError(r));
  return new Uint8Array(await r.arrayBuffer());
}
const isVideo = (f) => (f.mimeType || '').startsWith('video/') || /\.(mp4|mov|m4v|webm|mkv)$/i.test(f.name);
const isText = (f) => f.mimeType === 'text/plain' || /\.txt$/i.test(f.name) || f.mimeType === 'application/vnd.google-apps.document';
const textLines = (bytes) => new TextDecoder().decode(bytes).split(/\r?\n/).map((s) => s.trim()).filter(Boolean);

const HOOK_RE = /хук|hook/i;
const VIDEO_RE = /відео|видео|video|ролик|clip|main/i;
const driveItem = (f, key) => ({ name: f.name, get: () => cached(f.id, () => driveBytes(f, key)) });

// fill pools from the selected hooks folder and videos folder
async function loadPools(key, hooksId, videosId) {
  status('Читаю файли на Google Drive…');
  const [hookFiles, videoFiles] = await Promise.all([driveList(hooksId, key), driveList(videosId, key)]);
  pool.clips = hookFiles.filter(isVideo).map((f) => driveItem(f, key));
  pool.texts = [];
  for (const f of hookFiles.filter(isText)) pool.texts.push(...textLines(await driveBytes(f, key)));
  pool.videos = videoFiles.filter(isVideo).map((f) => driveItem(f, key));
}

// no subfolders: hooks = files with "hook/хук" in the name + text files, videos = the rest
function loadFlat(files, key) {
  pool.clips = files.filter((f) => isVideo(f) && HOOK_RE.test(f.name)).map((f) => driveItem(f, key));
  pool.videos = files.filter((f) => isVideo(f) && !HOOK_RE.test(f.name)).map((f) => driveItem(f, key));
}

function finishLoad() {
  updatePoolInfo();
  if (!pool.videos.length) status('У папці з відео не знайдено відеофайлів. Перевір вибір папок.', true);
  else if (!pool.clips.length && !pool.texts.length && !manualHooks().length) status('Відео знайдено, але хуків немає. Перевір папку з хуками або впиши хуки вручну.', true);
  else status('Готово. Тисни «Поєднати».');
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
    if (!subs.length) {
      $('#pickers').hidden = true;
      loadFlat(files, key);
      pool.texts = [];
      for (const f of files.filter(isText)) pool.texts.push(...textLines(await driveBytes(f, key)));
      return finishLoad();
    }
    // subfolders: guess which one is hooks and which is videos by name
    let hooks = subs.find((f) => HOOK_RE.test(f.name));
    let videos = subs.find((f) => f !== hooks && VIDEO_RE.test(f.name)) || subs.find((f) => f !== hooks);
    if (!hooks) hooks = subs.find((f) => f !== videos) || subs[0];
    const opts = subs.map((f) => `<option value="${f.id}">${f.name.replace(/</g, '&lt;')}</option>`).join('');
    $('#hooksPick').innerHTML = opts;
    $('#videosPick').innerHTML = opts;
    $('#hooksPick').value = hooks.id;
    $('#videosPick').value = videos ? videos.id : subs[0].id;
    $('#pickers').hidden = false;
    await loadPools(key, $('#hooksPick').value, $('#videosPick').value);
    finishLoad();
  } catch (e) {
    status(e.message, true);
  } finally { btn.disabled = false; }
});

['#hooksPick', '#videosPick'].forEach((s) => $(s).addEventListener('change', async () => {
  try {
    await loadPools($('#apiKey').value.trim(), $('#hooksPick').value, $('#videosPick').value);
    finishLoad();
  } catch (e) { status(e.message, true); }
}));

function cached(id, loader) {
  if (!cache.has(id)) cache.set(id, loader().catch((e) => { cache.delete(id); throw e; }));
  return cache.get(id);
}

// ---------- local files ----------
function readLocal() {
  const wrap = (f) => ({ name: f.name, get: () => cached('local:' + f.name + f.size, async () => new Uint8Array(await f.arrayBuffer())) });
  pool.clips = [...$('#localHookClips').files].map(wrap);
  pool.videos = [...$('#localVideos').files].map(wrap);
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
  const font = await (await fetch(new URL('./fonts/DejaVuSans-Bold.ttf', import.meta.url))).arrayBuffer();
  await ff.writeFile('font.ttf', new Uint8Array(font));
  ffmpeg = ff;
  return ff;
}

async function probe(ff, file) {
  const start = logLines.length;
  await ff.exec(['-hide_banner', '-i', file]);
  const text = logLines.slice(start).join('\n');
  const d = text.match(/Duration:\s*(\d+):(\d+):([\d.]+)/);
  return {
    hasAudio: /Stream #.*Audio:/.test(text),
    duration: d ? (+d[1]) * 3600 + (+d[2]) * 60 + parseFloat(d[3]) : 0,
  };
}

function wrapText(text, maxChars) {
  const words = text.split(/\s+/);
  const lines = [];
  let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > maxChars && cur) { lines.push(cur); cur = w; } else cur = (cur + ' ' + w).trim();
  }
  if (cur) lines.push(cur);
  return lines;
}

// render one source into a normalized segment (same size/fps/codecs so they can be glued)
async function renderSegment(ff, { input, output, W, H, maxSec, hookText, textSeconds }) {
  const info = await probe(ff, input);
  let dur = info.duration || 5;
  if (maxSec > 0) dur = Math.min(dur, maxSec);

  let vf = `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1,fps=30,format=yuv420p`;
  if (hookText) {
    const fs = Math.round(W * 0.066);
    const lines = wrapText(hookText, W >= 1000 ? 20 : 20);
    for (let i = 0; i < lines.length; i++) {
      await ff.writeFile(`line${i}.txt`, lines[i]);
      const y = Math.round(H * 0.16 + i * fs * 1.45);
      const enable = textSeconds ? `:enable='between(t,0,${textSeconds})'` : '';
      vf += `,drawtext=fontfile=font.ttf:textfile=line${i}.txt:fontsize=${fs}:fontcolor=white:box=1:boxcolor=black@0.6:boxborderw=${Math.round(fs * 0.3)}:x=(w-text_w)/2:y=${y}${enable}`;
    }
  }
  const args = ['-hide_banner', '-y', '-i', input];
  let filter;
  if (info.hasAudio) {
    filter = `[0:v]${vf}[v];[0:a]aresample=44100,aformat=channel_layouts=stereo[a]`;
  } else {
    filter = `[0:v]${vf}[v];anullsrc=r=44100:cl=stereo,atrim=duration=${dur.toFixed(3)}[a]`;
  }
  args.push('-filter_complex', filter, '-map', '[v]', '-map', '[a]', '-t', dur.toFixed(3),
    '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '24', '-r', '30',
    '-c:a', 'aac', '-b:a', '128k', '-ar', '44100', '-ac', '2', output);
  const code = await ff.exec(args);
  if (code !== 0) throw new Error(`ffmpeg не зміг обробити «${input}». Подивись журнал унизу.`);
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
    const opts = [];
    if (clips.length) opts.push('clip');
    if (texts.length) opts.push('text');
    if (!opts.length) throw new Error('Немає жодного хука: додай відео-хуки або текстові хуки.');
    // pick proportionally to how many hooks of each kind exist
    m = Math.random() < clips.length / (clips.length + texts.length) ? 'clip' : 'text';
  }
  if ((m === 'clip' || m === 'both') && !clips.length) throw new Error('Немає відео-хуків у папці.');
  if ((m === 'text' || m === 'both') && !texts.length) throw new Error('Немає текстових хуків (додай .txt / Google Doc у папку або впиши вручну).');
  return {
    mode: m,
    clip: m === 'clip' || m === 'both' ? pick(clips) : null,
    text: m === 'text' || m === 'both' ? pick(texts) : null,
  };
}

async function makeOne(ff, n, total) {
  const count = Math.max(1, +$('#count').value || 1);
  const W = $('#quality').value === '1080' ? 1080 : 720;
  const H = W === 1080 ? 1920 : 1280;
  const maxSec = Math.max(0, +$('#maxSec').value || 0);
  const hook = chooseHook($('#hookMode').value);
  const videos = pickMany(pool.videos, count);

  const jobs = [];
  if (hook.clip) jobs.push({ src: hook.clip, hookText: hook.mode === 'both' ? hook.text : null, textSeconds: 0, maxSec: 0 });
  videos.forEach((v, i) => jobs.push({
    src: v,
    hookText: hook.mode === 'text' && i === 0 ? hook.text : null,
    textSeconds: 3,
    maxSec,
  }));

  const segs = [];
  for (let i = 0; i < jobs.length; i++) {
    const j = jobs[i];
    const label = `Ролик ${n}/${total} · крок ${i + 1}/${jobs.length + 1}`;
    status(`${label}: завантажую «${j.src.name}»…`);
    const bytes = await j.src.get();
    const input = `in${i}` + (j.src.name.match(/\.\w+$/) || ['.mp4'])[0];
    await ff.writeFile(input, bytes.slice()); // copy: ffmpeg takes ownership of the buffer, the cache keeps the original
    status(`${label}: обробляю «${j.src.name}»…`);
    const output = `seg${i}.mp4`;
    await renderSegment(ff, { input, output, W, H, maxSec: j.maxSec, hookText: j.hookText, textSeconds: j.textSeconds });
    await ff.deleteFile(input);
    segs.push(output);
  }

  status(`Ролик ${n}/${total}: склеюю…`);
  await ff.writeFile('list.txt', segs.map((s) => `file '${s}'`).join('\n'));
  const out = `mix${n}.mp4`;
  const code = await ff.exec(['-hide_banner', '-y', '-f', 'concat', '-safe', '0', '-i', 'list.txt', '-c', 'copy', '-movflags', '+faststart', out]);
  if (code !== 0) throw new Error('Не вдалося склеїти відео. Подивись журнал унизу.');
  const data = await ff.readFile(out);
  for (const s of segs) await ff.deleteFile(s);
  await ff.deleteFile(out);

  return { blob: new Blob([data.buffer], { type: 'video/mp4' }), hook, videos };
}

function showResult({ blob, hook, videos }) {
  const url = URL.createObjectURL(blob);
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const el = document.createElement('div');
  el.className = 'card result';
  const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  el.innerHTML = `
    <video src="${url}" controls playsinline></video>
    <div>
      <b>Готово · ${(blob.size / 1048576).toFixed(1)} МБ</b>
      <ul>
        ${hook.clip ? `<li>Відео-хук: ${esc(hook.clip.name)}</li>` : ''}
        ${hook.text ? `<li>Текстовий хук: «${esc(hook.text)}»</li>` : ''}
        ${videos.map((v) => `<li>Відео: ${esc(v.name)}</li>`).join('')}
      </ul>
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

updatePoolInfo();
