// Рушій монтажу: перетворює налаштування (cfg) на команди ffmpeg.
import { FONTS, TRANSITIONS, COLOR_GRADES, ASPECTS } from './catalog.js';

// середня ширина літери відносно розміру шрифту (щоб правильно переносити рядки)
const CHAR_W = { montserrat: 0.66, unbounded: 0.82, rubik: 0.62, oswald: 0.47, russo: 0.68, manrope: 0.62, exo2: 0.62, comfortaa: 0.64, caveat: 0.42, lobster: 0.5, pixel: 1.0 };
const SIZE = { s: 0.05, m: 0.064, l: 0.082 };
const XFADES = TRANSITIONS.filter((t) => !['none', 'random'].includes(t.id)).map((t) => t.id);

const even = (n) => Math.round(n / 2) * 2;
const r3 = (n) => Number(n).toFixed(3);
const hex = (c) => '0x' + String(c || '#FFFFFF').replace('#', '');
const ass = (c, alpha = '00') => { const h = String(c || '#FFFFFF').replace('#', ''); return `&H${alpha}${h.slice(4, 6)}${h.slice(2, 4)}${h.slice(0, 2)}`; };
const isImage = (name) => /\.(jpe?g|png|webp)$/i.test(name);

export function dims(cfg) {
  const a = ASPECTS.find((x) => x.id === cfg.format.aspect) || ASPECTS[0];
  const k = cfg.format.hd ? 1.5 : 1;
  return { W: even(a.w * k), H: even(a.h * k) };
}

const fontFile = (cfg) => (FONTS.find((f) => f.id === cfg.font) || FONTS[0]).file;
const fontFamily = (cfg) => 'HM ' + (FONTS.find((f) => f.id === cfg.font) || FONTS[0]).file.replace('.ttf', '').replace(/^./, (c) => c.toUpperCase());

export async function loadFont(ff, cfg) {
  const file = fontFile(cfg);
  if (loadFont.current === file) return;
  const bytes = new Uint8Array(await (await fetch(new URL('./fonts/' + file, import.meta.url))).arrayBuffer());
  try { await ff.createDir('/fonts'); } catch (e) { /* exists */ }
  if (loadFont.current) { try { await ff.deleteFile('/fonts/' + loadFont.current); } catch (e) { /* ignore */ } }
  await ff.writeFile('/fonts/' + file, bytes);
  loadFont.current = file;
}

let sfxLoaded = new Set();
async function loadSfx(ff, id) {
  if (sfxLoaded.has(id)) return `sfx_${id}.mp3`;
  const bytes = new Uint8Array(await (await fetch(new URL(`./sfx/${id}.mp3`, import.meta.url))).arrayBuffer());
  await ff.writeFile(`sfx_${id}.mp3`, bytes);
  sfxLoaded.add(id);
  return `sfx_${id}.mp3`;
}

function wrapText(text, maxChars) {
  const lines = [];
  let cur = '';
  for (const w of text.split(/\s+/).filter(Boolean)) {
    if ((cur + ' ' + w).trim().length > maxChars && cur) { lines.push(cur); cur = w; } else cur = (cur + ' ' + w).trim();
  }
  if (cur) lines.push(cur);
  return lines;
}

function styleArgs(style, FS, boxColor) {
  if (style === 'box') return `:box=1:boxcolor=${hex(boxColor)}@0.92:boxborderw=${Math.round(FS * 0.28)}`;
  if (style === 'outline') return `:borderw=${Math.max(2, Math.round(FS * 0.09))}:bordercolor=black`;
  if (style === 'shadow') return `:shadowx=${Math.max(2, Math.round(FS * 0.06))}:shadowy=${Math.max(2, Math.round(FS * 0.06))}:shadowcolor=black@0.75`;
  return '';
}

let textFileN = 0;
/**
 * Builds drawtext filters for a text block shown between t0 and t1 (segment time).
 * Returns { filters: [...], pops: [times when a piece of text appears] }.
 */
export async function textFilters(ff, cfg, { text, t0, t1, W, H, anim, place, scale = 1 }) {
  const t = cfg.text;
  let content = String(text || '').trim();
  if (!content) return { filters: [], pops: [] };
  if (t.upper) content = content.toUpperCase();
  const base = Math.min(W, H);
  let FS = Math.round(base * SIZE[t.size || 'm'] * scale);
  const cw = CHAR_W[cfg.font] || 0.62;
  const font = `/fonts/${fontFile(cfg)}`;
  const style = styleArgs(t.style, FS, t.boxColor);
  const color = hex(t.color);
  const filters = [];
  const pops = [];
  const write = async (s) => { const name = `txt${textFileN++}.txt`; await ff.writeFile(name, s); return name; };
  const position = place || t.position || 'top';

  if (anim === 'words') {
    const words = content.split(/\s+/).filter(Boolean);
    const big = Math.round(FS * 1.45);
    const maxCh = Math.floor((W * 0.9) / (big * cw));
    const span = Math.max(t1 - t0, 0.5);
    const per = Math.min(0.75, Math.max(0.28, span / words.length));
    const yc = position === 'top' ? H * 0.22 : position === 'bottom' ? H * 0.74 : position === 'cta' ? H * 0.62 : H * 0.5;
    for (let i = 0; i < words.length; i++) {
      const a = t0 + i * per;
      const b = i === words.length - 1 ? Math.max(t1, a + per) : a + per;
      const fs = words[i].length > maxCh ? Math.round((W * 0.9) / (words[i].length * cw)) : big;
      const st = styleArgs(t.style, fs, t.boxColor);
      const file = await write(words[i]);
      const size = `'${fs}*if(lt(t-${r3(a)},0.12),0.6+(t-${r3(a)})/0.12*0.52,if(lt(t-${r3(a)},0.2),1.12-(t-${r3(a)}-0.12)/0.08*0.12,1))'`;
      filters.push(`drawtext=fontfile=${font}:textfile=${file}:fontsize=${size}:fontcolor=${color}${st}:x=(w-text_w)/2:y=${Math.round(yc)}-max_glyph_h/2:enable='gte(t,${r3(a)})*lt(t,${r3(b)})'`);
      pops.push(a);
    }
    return { filters, pops };
  }

  const lines = wrapText(content, Math.max(6, Math.floor((W * 0.86) / (FS * cw))));
  const lineH = FS * (t.style === 'box' ? 1.62 : 1.3);
  const blockH = lines.length * lineH;
  const yTop = position === 'top' ? H * 0.13 : position === 'bottom' ? H * 0.84 - blockH : position === 'cta' ? H * 0.62 - blockH / 2 : (H - blockH) / 2;
  const fadeOut = (b) => `(${r3(b)}-t)/0.2`;
  for (let i = 0; i < lines.length; i++) {
    const file = await write(lines[i]);
    const yc = Math.round(yTop + i * lineH + lineH / 2);
    const a = anim === 'lines' ? t0 + i * 0.45 : t0;
    const b = t1;
    let size = `${FS}`;
    let y = `${yc}-max_glyph_h/2`;
    let alpha = '';
    if (anim === 'fade' || anim === 'lines') alpha = `:alpha='min(min(1,(t-${r3(a)})/0.3),${fadeOut(b)})'`;
    if (anim === 'pop') size = `'${FS}*if(lt(t-${r3(a)},0.15),0.55+(t-${r3(a)})/0.15*0.57,if(lt(t-${r3(a)},0.25),1.12-(t-${r3(a)}-0.15)/0.1*0.12,1))'`;
    if (anim === 'slide' || anim === 'lines') {
      y = `'${yc}-max_glyph_h/2+${Math.round(FS * 1.2)}*pow(max(0,1-(t-${r3(a)})/0.3),2)'`;
      if (!alpha) alpha = `:alpha='min(min(1,(t-${r3(a)})/0.25),${fadeOut(b)})'`;
    }
    filters.push(`drawtext=fontfile=${font}:textfile=${file}:fontsize=${size}:fontcolor=${color}${style}:x=(w-text_w)/2:y=${y}${alpha}:enable='gte(t,${r3(a)})*lt(t,${r3(b)})'`);
    if (i === 0 || anim === 'lines') pops.push(a);
  }
  return { filters, pops };
}

function fitChain(cfg, W, H, inLabel, outLabel) {
  const fit = cfg.format.fit;
  if (fit === 'blur') {
    return `${inLabel}split[fa][fb];[fa]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},gblur=sigma=28,eq=brightness=-0.07[fbg];` +
      `[fb]scale=${W}:${H}:force_original_aspect_ratio=decrease:force_divisible_by=2[ffg];[fbg][ffg]overlay=(W-w)/2:(H-h)/2,setsar=1,fps=30${outLabel}`;
  }
  if (fit === 'bars') return `${inLabel}scale=${W}:${H}:force_original_aspect_ratio=decrease:force_divisible_by=2,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:black,setsar=1,fps=30${outLabel}`;
  return `${inLabel}scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1,fps=30${outLabel}`;
}

function subtitleFilter(cfg, H, srtName) {
  const s = cfg.subs;
  // SRT is rendered on a 288-unit-high canvas, so the size is a share of the frame height
  const size = Math.round(288 * ({ s: 0.045, m: 0.058, l: 0.075 }[s.size || 'm']));
  let st = `FontName=${fontFamily(cfg)},FontSize=${size},PrimaryColour=${ass(s.color)},Alignment=2,MarginV=${Math.round(288 * 0.1)}`;
  if (s.style === 'box') st += `,BorderStyle=3,Outline=6,Shadow=0,OutlineColour=${ass(cfg.text.boxColor || '#000000', '20')},BackColour=${ass(cfg.text.boxColor || '#000000', '20')}`;
  else if (s.style === 'outline') st += ',BorderStyle=1,Outline=2.2,Shadow=0,OutlineColour=&H00000000';
  else if (s.style === 'shadow') st += ',BorderStyle=1,Outline=0,Shadow=1.6,BackColour=&H64000000';
  else st += ',BorderStyle=1,Outline=0,Shadow=0';
  return `subtitles=${srtName}:fontsdir=/fonts:force_style='${st}'`;
}

export async function probe(ff, logs, file) {
  const start = logs.length;
  await ff.exec(['-hide_banner', '-i', file]);
  const text = logs.slice(start).join('\n');
  const d = text.match(/Duration:\s*(\d+):(\d+):([\d.]+)/);
  return { hasAudio: /Stream #.*Audio:/.test(text), duration: d ? (+d[1]) * 3600 + (+d[2]) * 60 + parseFloat(d[3]) : 0 };
}

/**
 * Renders one source into a normalized segment.
 * job: { input, name, maxSec, isHook, text: {content, t0, t1}|null, srt: filename|null }
 * Returns { output, duration (output seconds), pops: [output-time seconds] }
 */
export async function renderSegment(ff, logs, cfg, job, output, { final = false } = {}) {
  const { W, H } = dims(cfg);
  const speed = Math.min(2, Math.max(0.5, +cfg.format.speed || 1));
  const img = isImage(job.name);
  let dur;
  let hasAudio = false;
  if (img) {
    dur = job.maxSec > 0 ? job.maxSec : 3;
  } else {
    const info = await probe(ff, logs, job.input);
    hasAudio = info.hasAudio;
    dur = info.duration || 5;
    if (job.maxSec > 0) dur = Math.min(dur, job.maxSec);
  }
  const outDur = dur / speed;

  const chain = [];
  if (job.srt) chain.push(subtitleFilter(cfg, H, job.srt));
  const grade = COLOR_GRADES.find((g) => g.id === cfg.fx.grade);
  if (grade && grade.vf) chain.push(grade.vf);
  if (cfg.fx.sharpen) chain.push('unsharp=5:5:0.7');
  if (cfg.fx.vignette) chain.push('vignette=PI/5');
  if (cfg.fx.grain) chain.push('noise=alls=9:allf=t');
  if (img) chain.push(`scale=w='${W}*(1+0.08*t/${r3(dur)})':h=-2:eval=frame,crop=${W}:${H}`); // slow Ken Burns zoom for photos
  if (job.isHook && cfg.fx.hookZoom) chain.push(`scale=w='${W}*(1+0.18*max(0,1-t/0.45))':h=-2:eval=frame,crop=${W}:${H}`);
  if (job.isHook && cfg.fx.hookShake) {
    const sw = even(W * 1.06);
    chain.push(`scale=${sw}:-2,crop=${W}:${H}:x='(iw-ow)/2+(iw-ow)/2*sin(t*55)*lt(t,0.7)':y='(ih-oh)/2+(ih-oh)/2*cos(t*47)*lt(t,0.7)'`);
  }
  let pops = [];
  if (job.text) {
    const tf = await textFilters(ff, cfg, { text: job.text.content, t0: job.text.t0, t1: Math.min(job.text.t1, dur), W, H, anim: cfg.anim });
    chain.push(...tf.filters);
    pops = tf.pops.map((p) => p / speed);
  }
  if (speed !== 1) chain.push(`setpts=PTS/${speed}`);
  chain.push('format=yuv420p');

  let filter = fitChain(cfg, W, H, '[0:v]', '[fit]') + ';[fit]' + chain.join(',') + '[v]';
  const atempo = speed !== 1 ? `,atempo=${speed}` : '';
  if (hasAudio) filter += `;[0:a]aresample=44100,aformat=channel_layouts=stereo,volume=${cfg.audio.origVol}${atempo}[a]`;
  else filter += `;anullsrc=r=44100:cl=stereo,atrim=duration=${r3(outDur)}[a]`;

  const input = img ? ['-loop', '1', '-t', r3(dur), '-i', job.input] : ['-t', r3(dur), '-i', job.input];
  const enc = final ? encodeArgs(cfg) : ['-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '19'];
  const code = await ff.exec(['-hide_banner', '-y', ...input, '-filter_complex', filter, '-map', '[v]', '-map', '[a]',
    '-t', r3(outDur), ...enc, '-r', '30', '-c:a', 'aac', '-b:a', '160k', '-ar', '44100', '-ac', '2', output]);
  if (code !== 0) throw new Error(`ffmpeg не зміг обробити «${job.name}». Подивись журнал унизу.`);
  const real = await probe(ff, logs, output);
  return { output, duration: real.duration || outDur, pops };
}

function encodeArgs(cfg) {
  return cfg.format.compact ? ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '25'] : ['-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '25'];
}

export const needsFinalPass = (cfg, nSegs, extras) =>
  (cfg.transition.type !== 'none' && nSegs > 1) || extras.music || cfg.fx.progress || cfg.cta.enabled || extras.logo || cfg.audio.loudnorm ||
  ['sfxTransition', 'sfxHook', 'sfxText'].some((k) => cfg.audio[k] && cfg.audio[k] !== 'none');

/**
 * Joins rendered segments with transitions, music, sound effects, progress bar, CTA and logo.
 * segs: [{output, duration, pops}]; extras: { music: filename|null, logo: filename|null }
 */
export async function assemble(ff, logs, cfg, segs, extras, output) {
  const { W, H } = dims(cfg);
  const n = segs.length;
  if (!needsFinalPass(cfg, n, extras)) {
    await ff.writeFile('list.txt', segs.map((s) => `file '${s.output}'`).join('\n'));
    const code = await ff.exec(['-hide_banner', '-y', '-f', 'concat', '-safe', '0', '-i', 'list.txt', '-c', 'copy', '-movflags', '+faststart', output]);
    if (code !== 0) throw new Error('Не вдалося склеїти відео. Подивись журнал унизу.');
    return;
  }

  const args = ['-hide_banner', '-y'];
  segs.forEach((s) => args.push('-i', s.output));
  let idx = n;
  const parts = [];

  // 1) join segments: transitions (xfade) or plain concat
  const starts = [0];
  let total;
  const useX = cfg.transition.type !== 'none' && n > 1;
  if (useX) {
    let acc = segs[0].duration;
    let v = '[0:v]';
    let a = '[0:a]';
    for (let k = 1; k < n; k++) {
      const T = Math.max(0.1, Math.min(+cfg.transition.duration || 0.4, segs[k - 1].duration * 0.45, segs[k].duration * 0.45));
      const type = cfg.transition.type === 'random' ? XFADES[Math.floor(Math.random() * XFADES.length)] : cfg.transition.type;
      const off = acc - T;
      parts.push(`${v}[${k}:v]xfade=transition=${type}:duration=${r3(T)}:offset=${r3(off)}[vx${k}]`);
      parts.push(`${a}[${k}:a]acrossfade=d=${r3(T)}[ax${k}]`);
      v = `[vx${k}]`;
      a = `[ax${k}]`;
      starts.push(off);
      acc = off + segs[k].duration;
    }
    total = acc;
    parts.push(`${v}null[vj]`, `${a}anull[aj]`);
  } else {
    let acc = 0;
    segs.forEach((s, k) => { if (k) starts.push(acc); acc += s.duration; });
    total = acc;
    parts.push(segs.map((s, k) => `[${k}:v][${k}:a]`).join('') + `concat=n=${n}:v=1:a=1[vj][aj]`);
  }

  // 2) video extras
  let vl = '[vj]';
  if (cfg.fx.progress) {
    const ph = Math.max(6, Math.round(H * 0.008));
    parts.push(`color=c=${hex(cfg.fx.progressColor)}:s=${W}x${ph}:r=30[pbar]`);
    parts.push(`${vl}[pbar]overlay=x='-W+W*t/${r3(total)}':y=H-${ph}:shortest=1[vp]`);
    vl = '[vp]';
  }
  const pops = [];
  if (cfg.cta.enabled && cfg.cta.text) {
    const secs = Math.min(+cfg.cta.seconds || 2.5, total * 0.6);
    const tf = await textFilters(ff, cfg, { text: cfg.cta.text, t0: total - secs, t1: total + 1, W, H, anim: cfg.anim === 'words' ? 'pop' : cfg.anim, place: 'cta', scale: 1.1 });
    if (tf.filters.length) { parts.push(`${vl}${tf.filters.join(',')}[vc]`); vl = '[vc]'; }
    pops.push(total - secs);
  }
  if (extras.logo) {
    args.push('-i', extras.logo);
    const lw = even(W * (+cfg.logo.size || 0.18));
    const m = Math.round(Math.min(W, H) * 0.04);
    const pos = { tl: `${m}:${m}`, tr: `W-w-${m}:${m}`, bl: `${m}:H-h-${m}`, br: `W-w-${m}:H-h-${m}` }[cfg.logo.position] || `W-w-${m}:${m}`;
    parts.push(`[${idx}:v]scale=${lw}:-2,format=rgba,colorchannelmixer=aa=${cfg.logo.opacity}[lg]`);
    parts.push(`${vl}[lg]overlay=${pos}[vl]`);
    vl = '[vl]';
    idx++;
  }
  parts.push(`${vl}format=yuv420p[vout]`);

  // 3) audio: original + music + sound effects
  const mix = ['[aj]'];
  if (extras.music) {
    args.push('-stream_loop', '-1', '-i', extras.music);
    const fo = Math.max(0, total - 1.5);
    parts.push(`[${idx}:a]aresample=44100,aformat=channel_layouts=stereo,atrim=duration=${r3(total)},asetpts=N/SR/TB,volume=${cfg.audio.musicVol},afade=t=out:st=${r3(fo)}:d=1.5[mus]`);
    mix.push('[mus]');
    idx++;
  }
  const hits = [];
  if (cfg.audio.sfxHook !== 'none') hits.push([cfg.audio.sfxHook, 0]);
  if (cfg.audio.sfxTransition !== 'none') {
    for (let k = 1; k < n; k++) {
      const T = useX ? Math.min(+cfg.transition.duration || 0.4, 1) : 0;
      hits.push([cfg.audio.sfxTransition, Math.max(0, starts[k] + T / 2 - 0.25)]);
    }
  }
  if (cfg.audio.sfxText !== 'none') {
    segs.forEach((s, k) => s.pops.slice(0, 12).forEach((p) => hits.push([cfg.audio.sfxText, starts[k] + p])));
    pops.forEach((p) => hits.push([cfg.audio.sfxText, p]));
  }
  for (const [id, at] of hits) {
    if (at >= total) continue;
    const file = await loadSfx(ff, id);
    args.push('-i', file);
    const ms = Math.round(at * 1000);
    parts.push(`[${idx}:a]aresample=44100,aformat=channel_layouts=stereo,volume=${cfg.audio.sfxVol},adelay=${ms}|${ms}[sx${idx}]`);
    mix.push(`[sx${idx}]`);
    idx++;
  }
  let al;
  if (mix.length > 1) { parts.push(`${mix.join('')}amix=inputs=${mix.length}:duration=first:dropout_transition=0:normalize=0[am]`); al = '[am]'; } else al = '[aj]';
  if (cfg.audio.loudnorm) { parts.push(`${al}loudnorm=I=-14:TP=-1.5:LRA=11,aresample=44100[an]`); al = '[an]'; }
  parts.push(`${al}anull[aout]`);

  args.push('-filter_complex', parts.join(';'), '-map', '[vout]', '-map', '[aout]', '-t', r3(total),
    ...encodeArgs(cfg), '-r', '30', '-c:a', 'aac', '-b:a', '160k', '-ar', '44100', '-ac', '2', '-movflags', '+faststart', output);
  const code = await ff.exec(args);
  if (code !== 0) throw new Error('Не вдалося зібрати фінальне відео. Подивись журнал унизу.');
}

/** Renders a single still frame to preview text style, colour grade, progress bar and CTA. */
export async function previewFrame(ff, logs, cfg, { sample, sourceFile, sourceName }) {
  await loadFont(ff, cfg);
  const { W, H } = dims(cfg);
  const chain = [];
  const grade = COLOR_GRADES.find((g) => g.id === cfg.fx.grade);
  if (grade && grade.vf) chain.push(grade.vf);
  if (cfg.fx.sharpen) chain.push('unsharp=5:5:0.7');
  if (cfg.fx.vignette) chain.push('vignette=PI/5');
  if (cfg.fx.grain) chain.push('noise=alls=9:allf=t');
  const anim = cfg.anim === 'words' ? 'words' : 'static';
  const tf = await textFilters(ff, cfg, { text: anim === 'words' ? sample.split(/\s+/)[0] : sample, t0: 0, t1: 99, W, H, anim });
  chain.push(...tf.filters);
  if (cfg.cta.enabled && cfg.cta.text) {
    const c = await textFilters(ff, cfg, { text: cfg.cta.text, t0: 0, t1: 99, W, H, anim: 'static', place: 'cta', scale: 1.1 });
    chain.push(...c.filters);
  }
  if (cfg.fx.progress) {
    const ph = Math.max(6, Math.round(H * 0.008));
    chain.push(`drawbox=x=0:y=${H - ph}:w=${Math.round(W * 0.6)}:h=${ph}:color=${hex(cfg.fx.progressColor)}:t=fill`);
  }
  chain.push('format=rgb24');
  let src;
  let input = [];
  if (sourceFile) {
    input = isImage(sourceName) ? ['-i', sourceFile] : ['-ss', '1', '-i', sourceFile];
    src = fitChain(cfg, W, H, '[0:v]', '[fit]');
  } else {
    src = `color=c=0x2a1a4a:s=${W}x${H}:d=1,geq=r='40+60*Y/H':g='25+30*X/W':b='90+80*Y/H'[fit]`;
  }
  const code = await ff.exec(['-hide_banner', '-y', ...input, '-filter_complex', `${src};[fit]${chain.join(',')}[v]`, '-map', '[v]', '-frames:v', '1', 'preview.png']);
  if (code !== 0) throw new Error('Не вдалося зробити превʼю. Подивись журнал унизу.');
  const data = await ff.readFile('preview.png');
  await ff.deleteFile('preview.png');
  return new Blob([data.buffer], { type: 'image/png' });
}
