// Панель налаштувань монтажу: вкладки, плитки вибору, пресети. Стан зберігається в браузері.
import { FONTS, COLORS, TEXT_STYLES, ANIMATIONS, TRANSITIONS, COLOR_GRADES, SFX, ASPECTS, FITS, DEFAULTS, PRESETS } from './catalog.js';

const KEY = 'hookmixer_cfg';
const KEY_PRESETS = 'hookmixer_presets';
const clone = (o) => JSON.parse(JSON.stringify(o));
function merge(base, over) {
  const out = clone(base);
  for (const [k, v] of Object.entries(over || {})) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && typeof out[k] === 'object' ? merge(out[k], v) : v;
  }
  return out;
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let cfg = clone(DEFAULTS);
try { cfg = merge(DEFAULTS, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) { /* storage unavailable */ }
// older saved settings had subs.enabled instead of subs.source
if (cfg.subs.enabled !== undefined) { if (cfg.subs.enabled === false) cfg.subs.source = 'none'; delete cfg.subs.enabled; }
let onChange = () => {};

export const getCfg = () => cfg;
export function onSettingsChange(fn) { onChange = fn; }

function save() {
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch (e) { /* storage unavailable */ }
  onChange(cfg);
}
const get = (path) => path.split('.').reduce((o, k) => o[k], cfg);
function set(path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  keys.reduce((o, k) => o[k], cfg)[last] = value;
  save();
}

// ---------- building blocks ----------
function tiles(path, items, render) {
  const cur = get(path);
  return `<div class="tiles" data-path="${path}">${items.map((it) =>
    `<button type="button" class="tile${it.id === cur ? ' on' : ''}" data-val="${esc(it.id)}">${render ? render(it) : `<b>${esc(it.name)}</b>${it.note ? `<small>${esc(it.note)}</small>` : ''}`}</button>`).join('')}</div>`;
}
function swatches(path) {
  const cur = String(get(path)).toUpperCase();
  return `<div class="swatches" data-path="${path}">${COLORS.map((c) =>
    `<button type="button" class="sw${c === cur ? ' on' : ''}" data-val="${c}" style="background:${c}" aria-label="${c}"></button>`).join('')}
    <label class="sw custom" title="Свій колір"><input type="color" value="${/^#[0-9A-F]{6}$/.test(cur) ? cur : '#FFFFFF'}" data-path="${path}" data-kind="color"></label></div>`;
}
function seg(path, opts) {
  const cur = String(get(path));
  return `<div class="seg" data-path="${path}">${opts.map(([v, l]) => `<button type="button" class="${String(v) === cur ? 'on' : ''}" data-val="${v}">${l}</button>`).join('')}</div>`;
}
const toggle = (path, label) => `<label class="tog"><input type="checkbox" data-path="${path}" data-kind="bool" ${get(path) ? 'checked' : ''}> ${label}</label>`;
const range = (path, label, min, max, step, fmt = (v) => v) =>
  `<label class="rng">${label} <output>${fmt(get(path))}</output><input type="range" min="${min}" max="${max}" step="${step}" value="${get(path)}" data-path="${path}" data-kind="num" data-fmt="${fmt === pct ? 'pct' : fmt === secs ? 'secs' : ''}"></label>`;
const pct = (v) => Math.round(v * 100) + '%';
const secs = (v) => (+v).toFixed(1) + ' с';
const select = (path, items) => `<select data-path="${path}">${items.map((i) => `<option value="${i.id}" ${i.id === get(path) ? 'selected' : ''}>${esc(i.name)}</option>`).join('')}</select>`;
const field = (label, html) => `<div class="field"><span>${label}</span>${html}</div>`;

// ---------- tabs ----------
const TABS = [
  ['presets', 'Пресети', () => {
    let own = [];
    try { own = JSON.parse(localStorage.getItem(KEY_PRESETS) || '[]'); } catch (e) { /* ignore */ }
    return `<p class="hint">Готові стилі. Натисни, щоб застосувати всі налаштування разом, а потім підлаштуй що хочеш.</p>
      <div class="tiles">${PRESETS.map((p) => `<button type="button" class="tile" data-preset="${p.id}"><b>${esc(p.name)}</b><small>${esc(p.note)}</small></button>`).join('')}
      ${own.map((p, i) => `<button type="button" class="tile own" data-own="${i}"><b>${esc(p.name)}</b><small>Мій пресет</small><span class="del" data-del="${i}" title="Видалити">×</span></button>`).join('')}</div>
      <div class="row-inline"><input id="presetName" placeholder="Назва мого пресету"><button type="button" class="btn ghost" id="savePreset">Зберегти поточні налаштування</button></div>
      <button type="button" class="link" id="resetCfg">Скинути все до стандартних</button>`;
  }],
  ['font', 'Шрифт', () => tiles('font', FONTS, (f) => `<b class="fontprev" style="font-family:'prev-${f.id}'">Твій хук</b><small>${esc(f.name)} · ${esc(f.note)}</small>`)],
  ['text', 'Текст', () =>
    field('Колір тексту', swatches('text.color')) +
    field('Стиль', tiles('text.style', TEXT_STYLES)) +
    (cfg.text.style === 'box' ? field('Колір плашки', swatches('text.boxColor')) : '') +
    field('Розмір', seg('text.size', [['s', 'Малий'], ['m', 'Середній'], ['l', 'Великий']])) +
    field('Позиція', seg('text.position', [['top', 'Вгорі'], ['center', 'По центру'], ['bottom', 'Внизу']])) +
    toggle('text.upper', 'ВЕЛИКІ ЛІТЕРИ') +
    range('text.seconds', 'Скільки показувати текстовий хук', 1, 8, 0.5, secs)],
  ['anim', 'Анімація', () => `<p class="hint">Як зʼявляється текст хука й CTA.</p>` + tiles('anim', ANIMATIONS)],
  ['subs', 'Субтитри', () => {
    const src = cfg.subs.source || (cfg.subs.enabled === false ? 'none' : 'srt');
    return field('Звідки брати субтитри', tiles('subs.source', [
      { id: 'none', name: 'Без субтитрів', note: '' },
      { id: 'srt', name: 'З файлу .srt', note: 'Файл поруч із відео з тією ж назвою' },
      { id: 'auto', name: 'Автоматично', note: 'Розпізнати голос (є .srt — візьме його)' },
    ])) +
    (src === 'auto' ? `<p class="hint">Розпізнавання працює прямо у браузері. Перший раз завантажиться модель (Швидка ≈130 МБ, Точна ≈250 МБ), далі вона береться з кешу. Після монтажу субтитри можна завантажити як .srt, виправити й покласти поруч із відео на Drive — тоді візьмуться вже виправлені.</p>` +
      field('Модель', seg('subs.model', [['base', 'Швидка'], ['small', 'Точна']])) +
      field('Мова відео', seg('subs.lang', [['ukrainian', 'Українська'], ['english', 'Англійська'], ['russian', 'Російська'], ['slovak', 'Словацька'], ['auto', 'Визначити сама']])) +
      field('Слів на екрані одночасно', seg('subs.words', [[1, '1'], [2, '2'], [3, '3'], [4, '4']])) +
      field('Підсвітка слова, яке звучить', `<div class="swrow"><div class="swatches" data-path="subs.highlight"><button type="button" class="sw none${cfg.subs.highlight === 'none' ? ' on' : ''}" data-val="none" title="Без підсвітки">✕</button></div>` + swatches('subs.highlight') + '</div>') +
      field('Позиція', seg('subs.position', [['bottom', 'Внизу'], ['center', 'По центру']])) : '') +
    (src !== 'none' ? field('Колір', swatches('subs.color')) + field('Стиль', tiles('subs.style', TEXT_STYLES)) +
      field('Розмір', seg('subs.size', [['s', 'Малий'], ['m', 'Середній'], ['l', 'Великий']])) +
      `<p class="hint">Шрифт той самий, що у вкладці «Шрифт».</p>` : '');
  }],
  ['trans', 'Переходи', () => tiles('transition.type', TRANSITIONS, (t) => `<span class="tprev tp-${t.id}"><i></i><i></i></span><b>${esc(t.name)}</b><small>${esc(t.note)}</small>`) +
    range('transition.duration', 'Тривалість переходу', 0.2, 1, 0.05, secs)],
  ['fx', 'Ефекти', () =>
    field('Кольорокорекція', tiles('fx.grade', COLOR_GRADES, (g) => `<span class="gprev g-${g.id}"></span><b>${esc(g.name)}</b><small>${esc(g.note)}</small>`)) +
    `<div class="toggles">${toggle('fx.hookZoom', 'Зум-удар на хуку')}${toggle('fx.hookShake', 'Тряска на хуку')}${toggle('fx.vignette', 'Віньєтка')}${toggle('fx.grain', 'Зерно плівки')}${toggle('fx.sharpen', 'Різкість')}${toggle('fx.progress', 'Прогрес-бар внизу')}</div>` +
    (cfg.fx.progress ? field('Колір прогрес-бару', swatches('fx.progressColor')) : '')],
  ['audio', 'Звук', () =>
    toggle('audio.music', 'Фонова музика (з підпапки «music» на Drive або файл нижче)') +
    `<label class="field"><span>Свій трек (необовʼязково)</span><input type="file" id="localMusic" accept="audio/*"></label>` +
    range('audio.musicVol', 'Гучність музики', 0, 1, 0.05, pct) +
    range('audio.origVol', 'Гучність оригінального звуку', 0, 1.5, 0.05, pct) +
    range('audio.sfxVol', 'Гучність ефектів', 0, 1.5, 0.05, pct) +
    field('Звук на переході', select('audio.sfxTransition', SFX)) +
    field('Звук на старті хука', select('audio.sfxHook', SFX)) +
    field('Звук на появі тексту', select('audio.sfxText', SFX)) +
    `<div class="sfxplay">${SFX.filter((s) => s.id !== 'none').map((s) => `<button type="button" class="chip" data-sfx="${s.id}">▶ ${esc(s.name)}</button>`).join('')}</div>` +
    toggle('audio.loudnorm', 'Вирівняти гучність під соцмережі (-14 LUFS)')],
  ['format', 'Формат', () =>
    field('Співвідношення сторін', tiles('format.aspect', ASPECTS)) +
    field('Якщо відео іншої форми', tiles('format.fit', FITS)) +
    field('Швидкість', seg('format.speed', [[1, '1×'], [1.1, '1.1×'], [1.25, '1.25×'], [1.5, '1.5×']])) +
    toggle('format.hd', 'Висока якість (1080p, повільніше)') +
    toggle('format.compact', 'Менший розмір файлу (кодування повільніше)')],
  ['cta', 'CTA і лого', () =>
    toggle('cta.enabled', 'Заклик до дії в кінці ролика') +
    `<label class="field"><span>Текст CTA</span><input data-path="cta.text" data-kind="text" value="${esc(cfg.cta.text)}"></label>` +
    range('cta.seconds', 'Скільки секунд показувати', 1, 5, 0.5, secs) +
    toggle('logo.enabled', 'Логотип (з підпапки «logo» на Drive або файл нижче)') +
    `<label class="field"><span>Файл логотипу PNG (необовʼязково)</span><input type="file" id="localLogo" accept="image/png,image/webp,image/jpeg"></label>` +
    field('Позиція логотипу', seg('logo.position', [['tl', '↖'], ['tr', '↗'], ['bl', '↙'], ['br', '↘']])) +
    range('logo.size', 'Розмір логотипу', 0.08, 0.4, 0.01, pct) +
    range('logo.opacity', 'Прозорість логотипу', 0.2, 1, 0.05, pct)],
];

let active = 'presets';
let root;

export function mountSettings(el) {
  root = el;
  // font previews in the UI use the same files as the video
  const css = FONTS.map((f) => `@font-face{font-family:'prev-${f.id}';src:url('fonts/${f.file}') format('truetype');font-display:swap}`).join('');
  const st = document.createElement('style');
  st.textContent = css;
  document.head.appendChild(st);
  render();
  el.addEventListener('click', onClick);
  el.addEventListener('input', onInput);
  el.addEventListener('change', onInput);
}

function render() {
  const tabs = TABS.map(([id, name]) => `<button type="button" class="stab${id === active ? ' on' : ''}" data-tab="${id}">${name}</button>`).join('');
  const body = TABS.find((t) => t[0] === active)[2]();
  root.innerHTML = `<div class="stabs">${tabs}</div><div class="sbody">${body}</div>`;
}

function onClick(e) {
  const tab = e.target.closest('[data-tab]');
  if (tab) { active = tab.dataset.tab; render(); return; }
  const sfx = e.target.closest('[data-sfx]');
  if (sfx) { try { new Audio(`sfx/${sfx.dataset.sfx}.mp3`).play(); } catch (err) { /* ignore */ } return; }
  const del = e.target.closest('[data-del]');
  if (del) {
    e.stopPropagation();
    try { const own = JSON.parse(localStorage.getItem(KEY_PRESETS) || '[]'); own.splice(+del.dataset.del, 1); localStorage.setItem(KEY_PRESETS, JSON.stringify(own)); } catch (err) { /* ignore */ }
    render();
    return;
  }
  const pre = e.target.closest('[data-preset]');
  if (pre) { cfg = merge(DEFAULTS, PRESETS.find((p) => p.id === pre.dataset.preset).cfg); save(); flash(pre); return; }
  const own = e.target.closest('[data-own]');
  if (own) {
    try { cfg = merge(DEFAULTS, JSON.parse(localStorage.getItem(KEY_PRESETS) || '[]')[+own.dataset.own].cfg); } catch (err) { /* ignore */ }
    save(); flash(own); return;
  }
  if (e.target.id === 'savePreset') {
    const name = root.querySelector('#presetName').value.trim() || `Мій стиль ${new Date().toLocaleDateString('uk-UA')}`;
    try { const list = JSON.parse(localStorage.getItem(KEY_PRESETS) || '[]'); list.push({ name, cfg }); localStorage.setItem(KEY_PRESETS, JSON.stringify(list)); } catch (err) { /* ignore */ }
    render();
    return;
  }
  if (e.target.id === 'resetCfg') { cfg = clone(DEFAULTS); save(); render(); return; }
  const btn = e.target.closest('[data-val]');
  const group = btn && btn.closest('[data-path]');
  if (btn && group) {
    const raw = btn.dataset.val;
    const cur = get(group.dataset.path);
    set(group.dataset.path, typeof cur === 'number' ? +raw : raw);
    render();
  }
}

function onInput(e) {
  const el = e.target;
  if (!el.dataset.path) return;
  const kind = el.dataset.kind;
  let v = el.value;
  if (kind === 'bool') v = el.checked;
  else if (kind === 'num') {
    v = +el.value;
    const out = el.parentElement.querySelector('output');
    if (out) out.textContent = el.dataset.fmt === 'pct' ? pct(v) : el.dataset.fmt === 'secs' ? secs(v) : v;
  } else if (kind === 'color') v = el.value.toUpperCase();
  set(el.dataset.path, v);
  if (e.type === 'change' && (kind === 'bool' || kind === 'color' || el.tagName === 'SELECT')) render();
}

function flash(el) {
  render();
  const again = root.querySelector(`[data-preset="${el.dataset.preset}"],[data-own="${el.dataset.own}"]`);
  if (again) { again.classList.add('on'); setTimeout(() => again.classList.remove('on'), 900); }
}
