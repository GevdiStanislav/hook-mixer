// Рушій монтажу: перетворює налаштування (cfg) на команди ffmpeg.
import { FONTS, TRANSITIONS, COLOR_GRADES, ASPECTS } from './catalog.js';
import { FFmpeg } from './vendor/ffmpeg/index.js';

// середня ширина літери відносно розміру шрифту (щоб правильно переносити рядки)
const CHAR_W = { montserrat: 0.66, unbounded: 0.82, rubik: 0.62, oswald: 0.47, russo: 0.68, manrope: 0.62, exo2: 0.62, comfortaa: 0.64, caveat: 0.42, lobster: 0.5, pixel: 1.0 };
const SIZE = { s: 0.05, m: 0.064, l: 0.082 };
const XFADES = TRANSITIONS.filter((t) => !['none', 'random'].includes(t.id)).map((t) => t.id);

const even = (n) => Math.round(n / 2) * 2;

// Multi-threaded ffmpeg has a fixed pool of threads: decoders and filters stay on one thread,
// the video encoder (the heaviest part) gets several. Otherwise big rolls can run out of threads and freeze.
let MT = false;
export function setThreading(mt) { MT = mt; }
// pool = 32 threads: up to ~8 video inputs × 2 decoder threads + encoder (≤ 6) + filters (1) stays well inside it
const inThreads = () => (MT ? ['-threads', '2'] : []);
const graphThreads = () => (MT ? ['-filter_complex_threads', '1', '-filter_threads', '1'] : []);
const encThreads = () => (MT ? ['-threads', String(Math.min(6, Math.max(2, (navigator.hardwareConcurrency || 4) - 2)))] : []);
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
  if (/\.ass$/i.test(srtName)) return `subtitles=${srtName}:fontsdir=/fonts`; // auto captions carry their own style
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

// ---------- shared effect chains ----------

/** Effects that change the look of the picture (used for segments and the preview frame). */
export function lookChain(cfg, { lut = null, img = false, dur = 5, W, H } = {}) {
  const fx = cfg.fx;
  const c = [];
  if (fx.denoise) c.push('hqdn3d=3:3:6:6');
  if (fx.autolight) c.push('normalize=smoothing=30:independence=0.5');
  if (fx.grade === 'lut' && lut) c.push(`lut3d=${lut}`);
  const grade = COLOR_GRADES.find((g) => g.id === fx.grade);
  if (grade && grade.vf) c.push(grade.vf);
  if (+fx.bright !== 0 || +fx.contrast !== 1 || +fx.sat !== 1) c.push(`eq=brightness=${(+fx.bright).toFixed(2)}:contrast=${(+fx.contrast).toFixed(2)}:saturation=${(+fx.sat).toFixed(2)}`);
  if (+fx.temp && +fx.temp !== 6500) c.push(`colortemperature=temperature=${Math.round(+fx.temp)}`);
  if (fx.hold) c.push(`colorhold=color=${hex(fx.holdColor)}:similarity=0.25:blend=0.05`);
  if (fx.comic) c.push('edgedetect=mode=colormix:high=0.2:low=0.06');
  if (fx.kenburns && !img) c.push(`scale=w='${W}*(1+0.07*t/${r3(Math.max(dur, 1))})':h=-2:eval=frame,crop=${W}:${H}`);
  if (fx.sharpen) c.push('unsharp=5:5:0.7');
  if (fx.vhs) c.push(`chromashift=cbh=4:crh=-4,eq=saturation=0.8:contrast=1.08,noise=alls=14:allf=t,drawgrid=w=iw:h=4:t=1:c=black@0.18`);
  if (fx.flicker) c.push(`eq=eval=frame:brightness='0.05*(random(0)-0.5)'`);
  if (fx.trails) c.push('lagfun=decay=0.93');
  if (fx.motionblur) c.push('tmix=frames=3:weights=1 2 1');
  if (fx.vignette) c.push('vignette=PI/5');
  if (fx.grain) c.push('noise=alls=9:allf=t');
  return c;
}

const VOICE = {
  clean: 'highpass=f=80,lowpass=f=12000,afftdn=nf=-25,acompressor=threshold=-20dB:ratio=3:attack=5:release=60:makeup=2',
  phone: 'highpass=f=300,lowpass=f=3400,acompressor=threshold=-18dB:ratio=4,volume=1.4',
  echo: 'aecho=0.8:0.75:80|160:0.35|0.2',
  deep: 'asetrate=44100*0.86,aresample=44100,atempo=1.1628',
  high: 'asetrate=44100*1.25,aresample=44100,atempo=0.8',
  robot: "afftfilt=real='hypot(re,im)*sin(0)':imag='hypot(re,im)*cos(0)':win_size=512:overlap=0.75",
  chorus: 'chorus=0.6:0.9:50|60:0.4|0.32:0.25|0.4:2|2.3',
};

/**
 * Builds the filter graph for one source (one ffmpeg input with index k).
 * job: { input, name, maxSec, isHook, isLast, text: {content, t0, t1}|null, srt: filename|null, lut: filename|null }
 * Returns { inputArgs, graph, v, a, duration (output seconds), pops: [output-time seconds] }
 */
export async function buildSegment(ff, logs, cfg, job, k) {
  const { W, H } = dims(cfg);
  const L = (name) => `[${name}${k}]`;
  const speed = Math.min(2, Math.max(0.5, +cfg.format.speed || 1));
  const img = isImage(job.name);
  const ed = cfg.edit || {};
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
  dur = Math.max(0.2, Math.floor(dur * 30) / 30); // whole frames, so the predicted length is exact
  const boomerang = ed.boomerang && job.isHook && !img;
  const freeze = ed.freeze && job.isLast ? 1 : 0;
  const outDur = (dur / speed) * (boomerang ? 2 : 1) + freeze;

  // before framing: stabilise, rotate, mirror
  const pre = [];
  if (cfg.fx.stabilize && !img) pre.push('deshake');
  const rot = +ed.rotate || 0;
  if (rot === 90) pre.push('transpose=1');
  if (rot === 180) pre.push('transpose=1,transpose=1');
  if (rot === 270) pre.push('transpose=2');
  if (ed.mirror) pre.push('hflip');
  const inV = `[${k}:v]`;
  const g = [];
  if (pre.length) g.push(`${inV}${pre.join(',')}${L('pre')}`);
  g.push(fitChain(cfg, W, H, pre.length ? L('pre') : inV, L('fit')).replace(/\[(fa|fb|fbg|ffg)\]/g, (m, n) => L(n)));

  // look
  const look = [];
  if (job.srt) look.push(subtitleFilter(cfg, H, job.srt));
  look.push(...lookChain(cfg, { lut: job.lut, img, dur, W, H }));
  if (img) look.push(`scale=w='${W}*(1+0.08*t/${r3(dur)})':h=-2:eval=frame,crop=${W}:${H}`); // slow zoom for photos
  if (job.isHook && cfg.fx.glitch) look.push(`rgbashift=rh=-${Math.round(W * 0.012)}:bh=${Math.round(W * 0.012)}:enable='lt(mod(t,0.6),0.09)'`);
  if (job.isHook && cfg.fx.hookZoom) look.push(`scale=w='${W}*(1+0.18*max(0,1-t/0.45))':h=-2:eval=frame,crop=${W}:${H}`);
  if (job.isHook && cfg.fx.hookShake) {
    const sw = even(W * 1.06);
    look.push(`scale=${sw}:-2,crop=${W}:${H}:x='(iw-ow)/2+(iw-ow)/2*sin(t*55)*lt(t,0.7)':y='(ih-oh)/2+(ih-oh)/2*cos(t*47)*lt(t,0.7)'`);
  }
  look.push('format=yuv420p');
  g.push(`${L('fit')}${look.join(',')}${L('lk0')}`);
  let cur = L('lk0');
  if (cfg.fx.leaks) {
    g.push(`gradients=s=${W}x${H}:r=30:d=${r3(dur + 1)}:n=3:c0=0xff8a00:c1=0xff3b5c:c2=0x000000:speed=0.012,format=yuv420p${L('lkg')}`);
    g.push(`${cur}${L('lkg')}blend=all_mode=screen:all_opacity=0.32:shortest=1${L('lk1')}`);
    cur = L('lk1');
  }
  if (cfg.fx.letterbox) {
    const bar = Math.round(H * (W > H ? 0.11 : 0.08));
    g.push(`${cur}drawbox=x=0:y=0:w=iw:h=${bar}:color=black:t=fill,drawbox=x=0:y=ih-${bar}:w=iw:h=${bar}:color=black:t=fill${L('lk2')}`);
    cur = L('lk2');
  }

  // text on top of effects
  let pops = [];
  if (job.text) {
    const tf = await textFilters(ff, cfg, { text: job.text.content, t0: job.text.t0, t1: Math.min(job.text.t1, dur), W, H, anim: cfg.anim });
    if (tf.filters.length) { g.push(`${cur}${tf.filters.join(',')}${L('tx')}`); cur = L('tx'); }
    pops = tf.pops.map((p) => p / speed);
  }

  // audio
  const voice = VOICE[cfg.audio.voice];
  let aChain = 'aresample=44100,aformat=channel_layouts=stereo';
  if (cfg.audio.denoise && cfg.audio.voice !== 'clean') aChain += ',afftdn=nf=-25';
  if (voice) aChain += ',' + voice;
  aChain += `,volume=${cfg.audio.origVol}`;
  if (hasAudio) g.push(`[${k}:a]${aChain}${L('a0')}`);
  else g.push(`anullsrc=r=44100:cl=stereo,atrim=duration=${r3(dur)}${L('a0')}`);
  let aCur = L('a0');

  // boomerang: play forward, then backwards
  if (boomerang) {
    g.push(`${cur}split${L('bf')}${L('bb')}`, `${L('bb')}reverse${L('br')}`, `${L('bf')}${L('br')}concat=n=2:v=1:a=0${L('bv')}`);
    g.push(`${aCur}asplit${L('af')}${L('ab')}`, `${L('ab')}areverse${L('ar')}`, `${L('af')}${L('ar')}concat=n=2:v=0:a=1${L('ba')}`);
    cur = L('bv');
    aCur = L('ba');
  }
  const vTail = [];
  const aTail = [];
  if (speed !== 1) { vTail.push(`setpts=PTS/${speed}`); aTail.push(`atempo=${speed}`); }
  if (freeze) { vTail.push(`tpad=stop_mode=clone:stop_duration=${freeze}`); aTail.push(`apad=pad_dur=${freeze}`); }
  // exact length, so transitions line up without re-measuring
  // same frame rate, time base and format for every clip, so transitions can join them
  vTail.push(`trim=duration=${r3(outDur)},setpts=PTS-STARTPTS,fps=30,settb=1/30,setsar=1,format=yuv420p`);
  aTail.push(`apad,atrim=duration=${r3(outDur)},asetpts=PTS-STARTPTS,aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo,asettb=1/44100`);
  g.push(`${cur}${vTail.join(',')}${L('v')}`);
  g.push(`${aCur}${aTail.join(',')}${L('a')}`);

  const inputArgs = img ? [...inThreads(), '-loop', '1', '-t', r3(dur), '-i', job.input] : [...inThreads(), '-t', r3(dur), '-i', job.input];
  return { inputArgs, graph: g.join(';'), v: L('v'), a: L('a'), duration: outDur, pops };
}

/** Renders one source into its own file (used when the same clip is reused across many rolls). */
export async function renderSegment(ff, logs, cfg, job, output, { final = false } = {}) {
  const s = await buildSegment(ff, logs, cfg, job, 0);
  const enc = final ? encodeArgs(cfg) : ['-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '19', ...encThreads()];
  const code = await ff.exec(['-hide_banner', '-y', ...graphThreads(), ...s.inputArgs, '-filter_complex', s.graph, '-map', s.v, '-map', s.a,
    '-t', r3(s.duration), ...enc, '-r', '30', '-c:a', 'aac', '-b:a', '160k', '-ar', '44100', '-ac', '2', output]);
  if (code !== 0) throw new Error(`ffmpeg не зміг обробити «${job.name}». Подивись журнал унизу.`);
  const real = await probe(ff, logs, output);
  return { output, duration: real.duration || s.duration, pops: s.pops };
}

/** One-pass render: every source and every effect in a single ffmpeg run (one encode instead of two). */
export async function renderAll(ff, logs, cfg, jobs, extras, output) {
  const args = ['-hide_banner', '-y', ...graphThreads()];
  const parts = [];
  const segs = [];
  for (let k = 0; k < jobs.length; k++) {
    const s = await buildSegment(ff, logs, cfg, jobs[k], k);
    args.push(...s.inputArgs);
    parts.push(s.graph);
    segs.push({ v: s.v, a: s.a, duration: s.duration, pops: s.pops });
  }
  return assemble(ff, logs, cfg, segs, extras, output, { args, parts });
}

const SILENCE = { soft: [-38, 0.6], mid: [-32, 0.4], hard: [-27, 0.28] };
/**
 * Cuts out pauses (silence) from a talking video. Returns the new file name,
 * or the original one when there is nothing to cut.
 */
export async function cutSilence(ff, logs, input, level = 'mid') {
  const info = await probe(ff, logs, input);
  if (!info.hasAudio || !info.duration) return input;
  const [db, minDur] = SILENCE[level] || SILENCE.mid;
  const start = logs.length;
  await ff.exec(['-hide_banner', '-i', input, '-vn', '-af', `silencedetect=noise=${db}dB:d=${minDur}`, '-f', 'null', '-']);
  const text = logs.slice(start).join('\n');
  const silences = [];
  const re = /silence_start: (-?[\d.]+)[\s\S]*?silence_end: ([\d.]+)/g;
  let m;
  while ((m = re.exec(text))) silences.push([Math.max(0, +m[1]), +m[2]]);
  const tail = text.match(/silence_start: ([\d.]+)(?![\s\S]*silence_end)/);
  if (tail) silences.push([+tail[1], info.duration]);
  const pad = 0.08;
  const keep = [];
  let t = 0;
  for (const [a, b] of silences) {
    if (a - t > 0.05) keep.push([Math.max(0, t - (t ? pad : 0)), a + pad]);
    t = b;
  }
  if (info.duration - t > 0.05) keep.push([Math.max(0, t - pad), info.duration]);
  const kept = keep.reduce((s, [a, b]) => s + (b - a), 0);
  if (!keep.length || info.duration - kept < 0.3) return input;
  const sel = keep.slice(0, 80).map(([a, b]) => `between(t,${r3(a)},${r3(b)})`).join('+');
  const out = 'cut_' + input.replace(/\.\w+$/, '') + '.mp4';
  const code = await ff.exec(['-hide_banner', '-y', '-i', input, '-filter_complex',
    `[0:v]fps=30,select='${sel}',setpts=N/30/TB[v];[0:a]aselect='${sel}',asetpts=N/SR/TB[a]`,
    '-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '18', '-c:a', 'aac', '-b:a', '192k', out]);
  if (code !== 0) return input;
  await ff.deleteFile(input);
  return out;
}

function encodeArgs(cfg) {
  return [...(cfg.format.compact ? ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '25'] : ['-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '25']), ...encThreads()];
}

const hasHandle = (cfg) => cfg.brand && cfg.brand.enabled && String(cfg.brand.handle || '').trim();
export const needsFinalPass = (cfg, nSegs, extras) =>
  (cfg.transition.type !== 'none' && nSegs > 1) || extras.music || cfg.fx.progress || cfg.cta.enabled || extras.logo || cfg.audio.loudnorm ||
  cfg.edit.fadeIn || cfg.edit.fadeOut || hasHandle(cfg) ||
  ['sfxTransition', 'sfxHook', 'sfxText'].some((k) => cfg.audio[k] && cfg.audio[k] !== 'none');

/**
 * Joins rendered segments with transitions, music, sound effects, progress bar, CTA, logo, @handle and fades.
 * segs: [{output, duration, pops}]; extras: { music: filename|null, logo: filename|null }
 * Returns the total duration in seconds.
 */
export async function assemble(ff, logs, cfg, segs, extras, output, pre = null) {
  const { W, H } = dims(cfg);
  const n = segs.length;
  if (!pre && !needsFinalPass(cfg, n, extras)) {
    await ff.writeFile('list.txt', segs.map((s) => `file '${s.output}'`).join('\n'));
    const code = await ff.exec(['-hide_banner', '-y', '-f', 'concat', '-safe', '0', '-i', 'list.txt', '-c', 'copy', '-movflags', '+faststart', output]);
    if (code !== 0) throw new Error('Не вдалося склеїти відео. Подивись журнал унизу.');
    return segs.reduce((s, x) => s + x.duration, 0);
  }

  const args = pre ? pre.args : ['-hide_banner', '-y', ...graphThreads()];
  if (!pre) segs.forEach((s) => args.push(...inThreads(), '-i', s.output));
  let idx = n;
  const parts = pre ? pre.parts : [];
  const sv = (k) => segs[k].v || `[${k}:v]`;
  const sa = (k) => segs[k].a || `[${k}:a]`;

  // 1) join segments: transitions (xfade) or plain concat
  const starts = [0];
  let total;
  const useX = cfg.transition.type !== 'none' && n > 1;
  if (useX) {
    let acc = segs[0].duration;
    let v = sv(0);
    let a = sa(0);
    for (let k = 1; k < n; k++) {
      const T = Math.max(0.1, Math.min(+cfg.transition.duration || 0.4, segs[k - 1].duration * 0.45, segs[k].duration * 0.45));
      const type = cfg.transition.type === 'random' ? XFADES[Math.floor(Math.random() * XFADES.length)] : cfg.transition.type;
      const off = acc - T;
      parts.push(`${v}${sv(k)}xfade=transition=${type}:duration=${r3(T)}:offset=${r3(off)}[vx${k}]`);
      parts.push(`${a}${sa(k)}acrossfade=d=${r3(T)}[ax${k}]`);
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
    parts.push(segs.map((s, k) => sv(k) + sa(k)).join('') + `concat=n=${n}:v=1:a=1[vj][aj]`);
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
  if (hasHandle(cfg)) {
    const name = `txt${Date.now() % 100000}h.txt`;
    await ff.writeFile(name, String(cfg.brand.handle).trim());
    const fs = Math.round(Math.min(W, H) * 0.034);
    parts.push(`${vl}drawtext=fontfile=/fonts/${fontFile(cfg)}:textfile=${name}:fontsize=${fs}:fontcolor=white@0.8:shadowx=2:shadowy=2:shadowcolor=black@0.6:x=(w-text_w)/2:y=h-${Math.round(H * 0.045)}-text_h[vh]`);
    vl = '[vh]';
  }
  if (extras.logo) {
    args.push(...inThreads(), '-i', extras.logo);
    const lw = even(W * (+cfg.logo.size || 0.18));
    const m = Math.round(Math.min(W, H) * 0.04);
    const pos = { tl: `${m}:${m}`, tr: `W-w-${m}:${m}`, bl: `${m}:H-h-${m}`, br: `W-w-${m}:H-h-${m}` }[cfg.logo.position] || `W-w-${m}:${m}`;
    parts.push(`[${idx}:v]scale=${lw}:-2,format=rgba,colorchannelmixer=aa=${cfg.logo.opacity}[lg]`);
    parts.push(`${vl}[lg]overlay=${pos}[vl]`);
    vl = '[vl]';
    idx++;
  }
  const vf = [];
  if (cfg.edit.fadeIn) vf.push('fade=t=in:st=0:d=0.5');
  if (cfg.edit.fadeOut) vf.push(`fade=t=out:st=${r3(Math.max(0, total - 0.7))}:d=0.7`);
  vf.push('format=yuv420p');
  parts.push(`${vl}${vf.join(',')}[vout]`);

  // 3) audio: original + music (optionally ducked under the voice) + sound effects
  let voice = '[aj]';
  const mix = [];
  if (extras.music) {
    args.push(...inThreads(), '-stream_loop', '-1', '-i', extras.music);
    const fo = Math.max(0, total - 1.5);
    const fin = cfg.audio.musicFadeIn ? ',afade=t=in:st=0:d=1' : '';
    parts.push(`[${idx}:a]aresample=44100,aformat=channel_layouts=stereo,atrim=duration=${r3(total)},asetpts=N/SR/TB,volume=${cfg.audio.musicVol}${fin},afade=t=out:st=${r3(fo)}:d=1.5[mus]`);
    if (cfg.audio.duck) {
      parts.push('[aj]asplit=2[ajv][ajsc]');
      parts.push('[mus][ajsc]sidechaincompress=threshold=0.03:ratio=10:attack=15:release=350[mduck]');
      voice = '[ajv]';
      mix.push('[mduck]');
    } else mix.push('[mus]');
    idx++;
  }
  mix.unshift(voice);
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
    args.push(...inThreads(), '-i', file);
    const ms = Math.round(at * 1000);
    parts.push(`[${idx}:a]aresample=44100,aformat=channel_layouts=stereo,volume=${cfg.audio.sfxVol},adelay=${ms}|${ms}[sx${idx}]`);
    mix.push(`[sx${idx}]`);
    idx++;
  }
  let al;
  if (mix.length > 1) { parts.push(`${mix.join('')}amix=inputs=${mix.length}:duration=first:dropout_transition=0:normalize=0[am]`); al = '[am]'; } else al = voice;
  if (cfg.audio.loudnorm) { parts.push(`${al}loudnorm=I=-14:TP=-1.5:LRA=11,aresample=44100[an]`); al = '[an]'; }
  const af = [];
  if (cfg.edit.fadeIn) af.push('afade=t=in:st=0:d=0.4');
  if (cfg.edit.fadeOut) af.push(`afade=t=out:st=${r3(Math.max(0, total - 0.7))}:d=0.7`);
  parts.push(`${al}${af.length ? af.join(',') : 'anull'}[aout]`);

  args.push('-filter_complex', parts.join(';'), '-map', '[vout]', '-map', '[aout]', '-t', r3(total),
    ...encodeArgs(cfg), '-r', '30', '-c:a', 'aac', '-b:a', '160k', '-ar', '44100', '-ac', '2', '-movflags', '+faststart', output);
  const code = await ff.exec(args);
  if (code !== 0) throw new Error('Не вдалося зібрати фінальне відео. Подивись журнал унизу.');
  return total;
}

/** Extra formats from the finished MP4: GIF, cover PNG, MP3 (WebM goes through encodeWebm). Returns [{ label, name, blob }]. */
export async function exportExtras(ff, cfg, mp4, total, base, onStep = () => {}) {
  const ex = cfg.export || {};
  const out = [];
  const run = async (label, file, type, args) => {
    onStep(label);
    const code = await ff.exec(['-hide_banner', '-y', ...args, file]);
    if (code !== 0) return;
    const data = await ff.readFile(file);
    await ff.deleteFile(file);
    out.push({ label, name: `${base}.${file.split('.').pop()}`, blob: new Blob([data.buffer], { type }) });
  };
  if (ex.cover) await run('Обкладинка (PNG)', 'cover.png', 'image/png', ['-ss', r3(Math.min(1, total / 3)), '-i', mp4, '-frames:v', '1']);
  if (ex.mp3) await run('Тільки звук (MP3)', 'audio.mp3', 'audio/mpeg', ['-i', mp4, '-vn', '-c:a', 'libmp3lame', '-b:a', '192k']);
  if (ex.gif) {
    await run('GIF (перші 8 с)', 'anim.gif', 'image/gif', ['-t', '8', '-i', mp4, '-filter_complex',
      'fps=12,scale=360:-2:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4', '-loop', '0']);
  }
  return out;
}

/** Renders a single still frame to preview text style, colour grade, progress bar and CTA. */
export async function previewFrame(ff, logs, cfg, { sample, sourceFile, sourceName, lut = null }) {
  await loadFont(ff, cfg);
  const { W, H } = dims(cfg);
  const chain = lookChain(cfg, { lut, img: isImage(sourceName || ''), dur: 5, W, H }).filter((f) => !/^(tmix|lagfun|scale=w)/.test(f));
  if (cfg.fx.letterbox) {
    const bar = Math.round(H * (W > H ? 0.11 : 0.08));
    chain.push(`drawbox=x=0:y=0:w=iw:h=${bar}:color=black:t=fill,drawbox=x=0:y=ih-${bar}:w=iw:h=${bar}:color=black:t=fill`);
  }
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

/** Forget what was loaded into an ffmpeg instance (call after replacing the instance). */
export function resetRenderCache() {
  loadFont.current = null;
  sfxLoaded = new Set();
}

/**
 * WebM (VP8) needs a lot of memory, so it runs in its own fresh ffmpeg that is closed right after.
 * Call it after closing the main ffmpeg instance. Returns a Blob or null.
 */
export async function encodeWebm(mp4Bytes) {
  const f2 = new FFmpeg();
  try {
    const core = new URL('./vendor/core/', import.meta.url).href;
    await f2.load({ coreURL: core + 'ffmpeg-core.js', wasmURL: core + 'ffmpeg-core.wasm', classWorkerURL: new URL('./vendor/ffmpeg/worker.js?v=20261026b', import.meta.url).href });
    await f2.writeFile('in.mp4', mp4Bytes);
    const code = await f2.exec(['-hide_banner', '-y', '-i', 'in.mp4', '-c:v', 'libvpx', '-deadline', 'realtime', '-cpu-used', '8', '-lag-in-frames', '0',
      '-auto-alt-ref', '0', '-threads', '1', '-b:v', '2500k', '-c:a', 'libvorbis', '-b:a', '128k', 'video.webm']);
    if (code !== 0) return null;
    const data = await f2.readFile('video.webm');
    return new Blob([data.buffer], { type: 'video/webm' });
  } catch (e) {
    return null; // WebM is optional: skip it if the browser runs out of memory
  } finally {
    f2.terminate();
  }
}
