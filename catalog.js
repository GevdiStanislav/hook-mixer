// Каталог усіх налаштувань монтажу. Щоб додати шрифт, перехід чи ефект, достатньо додати рядок сюди.

export const FONTS = [
  { id: 'montserrat', name: 'Montserrat', note: 'Класика Reels', file: 'montserrat.ttf' },
  { id: 'unbounded', name: 'Unbounded', note: 'Широкий, трендовий', file: 'unbounded.ttf' },
  { id: 'rubik', name: 'Rubik', note: 'Округлий, дружній', file: 'rubik.ttf' },
  { id: 'oswald', name: 'Oswald', note: 'Вузький, кіно', file: 'oswald.ttf' },
  { id: 'russo', name: 'Russo One', note: 'Спорт, енергія', file: 'russo.ttf' },
  { id: 'manrope', name: 'Manrope', note: 'Мінімалізм', file: 'manrope.ttf' },
  { id: 'exo2', name: 'Exo 2', note: 'Технології', file: 'exo2.ttf' },
  { id: 'comfortaa', name: 'Comfortaa', note: 'Мʼякий, лайфстайл', file: 'comfortaa.ttf' },
  { id: 'caveat', name: 'Caveat', note: 'Рукописний', file: 'caveat.ttf' },
  { id: 'lobster', name: 'Lobster', note: 'Каліграфія', file: 'lobster.ttf' },
  { id: 'pixel', name: 'Press Start 2P', note: 'Піксельний, ретро', file: 'pixel.ttf' },
];

export const COLORS = ['#FFFFFF', '#FFD60A', '#3DDC97', '#FF3B5C', '#00D1FF', '#B388FF', '#FF8A00', '#111111'];

export const TEXT_STYLES = [
  { id: 'box', name: 'Плашка', note: 'Текст на кольоровому фоні' },
  { id: 'outline', name: 'Обводка', note: 'Як у TikTok' },
  { id: 'shadow', name: 'Тінь', note: 'Мʼяка тінь під текстом' },
  { id: 'plain', name: 'Без фону', note: 'Тільки текст' },
];

export const ANIMATIONS = [
  { id: 'static', name: 'Статично', note: 'Текст просто є' },
  { id: 'fade', name: 'Плавна поява', note: 'Fade in' },
  { id: 'pop', name: 'Pop', note: 'Вискакує й росте' },
  { id: 'slide', name: 'Виїзд знизу', note: 'Підʼїжджає вгору' },
  { id: 'lines', name: 'По рядках', note: 'Рядки зʼявляються по черзі' },
  { id: 'words', name: 'По одному слову', note: 'Великі слова по черзі (Hormozi-стиль)' },
];

export const TRANSITIONS = [
  { id: 'none', name: 'Різкий склей', note: 'Без переходу, найшвидше' },
  { id: 'random', name: 'Випадковий', note: 'Щоразу інший з цього списку' },
  { id: 'fade', name: 'Плавне згасання', note: 'Мʼякий, універсальний' },
  { id: 'fadeblack', name: 'Через чорний', note: 'Кіношна пауза' },
  { id: 'fadewhite', name: 'Спалах', note: 'Білий флеш' },
  { id: 'slideleft', name: 'Свайп вліво', note: 'Як гортання сторіс' },
  { id: 'slideup', name: 'Свайп вгору', note: 'Як скрол Reels' },
  { id: 'zoomin', name: 'Зум-ін', note: 'Влітає в наступний кадр' },
  { id: 'smoothleft', name: 'Плавний зсув', note: 'Мʼякий рух вбік' },
  { id: 'circleopen', name: 'Коло', note: 'Розкривається з центру' },
  { id: 'pixelize', name: 'Пікселі', note: 'Цифровий, гейм' },
  { id: 'hblur', name: 'Розмиття', note: 'Динамічний blur' },
];

// решта переходів ffmpeg (xfade) — показуються в розділі «Ще переходи»
export const MORE_TRANSITIONS = [
  { id: 'fadefast', name: 'Швидке згасання' }, { id: 'fadeslow', name: 'Повільне згасання' }, { id: 'fadegrays', name: 'Через сірий' },
  { id: 'dissolve', name: 'Розчинення' }, { id: 'distance', name: 'Відстань' }, { id: 'radial', name: 'Радар' },
  { id: 'slideright', name: 'Свайп вправо' }, { id: 'slidedown', name: 'Свайп вниз' },
  { id: 'smoothright', name: 'Плавно вправо' }, { id: 'smoothup', name: 'Плавно вгору' }, { id: 'smoothdown', name: 'Плавно вниз' },
  { id: 'wipeleft', name: 'Шторка вліво' }, { id: 'wiperight', name: 'Шторка вправо' }, { id: 'wipeup', name: 'Шторка вгору' }, { id: 'wipedown', name: 'Шторка вниз' },
  { id: 'wipetl', name: 'Шторка ↖' }, { id: 'wipetr', name: 'Шторка ↗' }, { id: 'wipebl', name: 'Шторка ↙' }, { id: 'wipebr', name: 'Шторка ↘' },
  { id: 'circleclose', name: 'Коло закривається' }, { id: 'circlecrop', name: 'Коло-маска' }, { id: 'rectcrop', name: 'Прямокутник' },
  { id: 'vertopen', name: 'Двері по вертикалі' }, { id: 'vertclose', name: 'Двері закриваються' }, { id: 'horzopen', name: 'Відкриття по горизонталі' }, { id: 'horzclose', name: 'Закриття по горизонталі' },
  { id: 'diagtl', name: 'Діагональ ↖' }, { id: 'diagtr', name: 'Діагональ ↗' }, { id: 'diagbl', name: 'Діагональ ↙' }, { id: 'diagbr', name: 'Діагональ ↘' },
  { id: 'hlslice', name: 'Слайси вліво' }, { id: 'hrslice', name: 'Слайси вправо' }, { id: 'vuslice', name: 'Слайси вгору' }, { id: 'vdslice', name: 'Слайси вниз' },
  { id: 'squeezeh', name: 'Стиснення ↔' }, { id: 'squeezev', name: 'Стиснення ↕' },
];

export const VOICE_FX = [
  { id: 'none', name: 'Як є', note: 'Без обробки' },
  { id: 'clean', name: 'Чистий голос', note: 'Прибрати гул і шум, вирівняти' },
  { id: 'phone', name: 'Телефон', note: 'Як дзвінок' },
  { id: 'echo', name: 'Луна', note: 'Велика зала' },
  { id: 'deep', name: 'Низький', note: 'Глибший голос' },
  { id: 'high', name: 'Високий', note: 'Мультяшний' },
  { id: 'robot', name: 'Робот', note: 'Металевий' },
  { id: 'chorus', name: 'Хор', note: 'Обʼємний' },
];

export const COLOR_GRADES = [
  { id: 'none', name: 'Оригінал', note: 'Без змін', vf: '' },
  { id: 'vivid', name: 'Яскравий', note: 'Соковиті кольори', vf: 'eq=saturation=1.35:contrast=1.08' },
  { id: 'punchy', name: 'Контраст', note: 'Різкий, сильний', vf: 'eq=contrast=1.25:brightness=0.02:saturation=1.15' },
  { id: 'cinematic', name: 'Кіно', note: 'Teal & orange', vf: 'colorbalance=rs=-0.08:bs=0.08:rh=0.08:bh=-0.08,eq=contrast=1.1:saturation=1.1' },
  { id: 'warm', name: 'Теплий', note: 'Золоте світло', vf: 'colorbalance=rs=0.08:gs=0.02:bs=-0.08:rm=0.06:bm=-0.06' },
  { id: 'cool', name: 'Холодний', note: 'Свіжий, синюватий', vf: 'colorbalance=rs=-0.06:bs=0.08:rm=-0.04:bm=0.06' },
  { id: 'vintage', name: 'Вінтаж', note: 'Плівка 90-х', vf: 'curves=preset=vintage,eq=saturation=0.85' },
  { id: 'matte', name: 'Матовий', note: 'Мʼякий, естетика', vf: "curves=all='0/0.08 1/0.92',eq=saturation=0.9" },
  { id: 'bw', name: 'Чорно-білий', note: 'Драма', vf: 'hue=s=0,eq=contrast=1.15' },
  { id: 'lut', name: 'Мій LUT', note: '.cube з папки «lut» або файл', vf: '' },
];

export const SFX = [
  { id: 'none', name: 'Без звуку' },
  { id: 'whoosh', name: 'Whoosh' },
  { id: 'swoosh', name: 'Swoosh (коротший)' },
  { id: 'pop', name: 'Pop' },
  { id: 'click', name: 'Клік' },
  { id: 'bass', name: 'Бас-удар' },
  { id: 'ding', name: 'Дзвіночок' },
  { id: 'riser', name: 'Наростання' },
  { id: 'glitch', name: 'Глітч' },
  { id: 'shutter', name: 'Затвор камери' },
];

export const ASPECTS = [
  { id: '9:16', name: '9:16', note: 'Reels, TikTok, Shorts', w: 720, h: 1280 },
  { id: '4:5', name: '4:5', note: 'Стрічка Instagram', w: 720, h: 900 },
  { id: '1:1', name: '1:1', note: 'Квадрат', w: 720, h: 720 },
  { id: '16:9', name: '16:9', note: 'YouTube', w: 1280, h: 720 },
];

export const FITS = [
  { id: 'crop', name: 'Обрізати', note: 'Заповнити весь кадр' },
  { id: 'blur', name: 'Розмитий фон', note: 'Все відео + блюр по краях' },
  { id: 'bars', name: 'Чорні смуги', note: 'Все відео без обрізки' },
];

export const DEFAULTS = {
  font: 'montserrat',
  text: { color: '#FFFFFF', style: 'box', boxColor: '#000000', size: 'm', position: 'top', upper: false, seconds: 3 },
  anim: 'pop',
  subs: { source: 'srt', model: 'base', lang: 'ukrainian', words: 3, highlight: '#FFD60A', position: 'bottom', color: '#FFFFFF', style: 'outline', size: 'm' },
  transition: { type: 'none', duration: 0.4 },
  fx: {
    grade: 'none', vignette: false, grain: false, sharpen: false, hookZoom: false, hookShake: false, progress: false, progressColor: '#3DDC97',
    bright: 0, contrast: 1, sat: 1, temp: 6500,
    kenburns: false, letterbox: false, vhs: false, glitch: false, leaks: false, flicker: false, trails: false, motionblur: false,
    comic: false, autolight: false, denoise: false, stabilize: false, hold: false, holdColor: '#FF3B5C',
  },
  edit: { cutSilence: false, silenceLevel: 'mid', boomerang: false, freeze: false, fadeIn: false, fadeOut: false, mirror: false, rotate: 0 },
  audio: { music: true, musicVol: 0.25, origVol: 1, sfxVol: 0.8, sfxTransition: 'whoosh', sfxHook: 'none', sfxText: 'none', loudnorm: false, voice: 'none', denoise: false, duck: false, musicFadeIn: true },
  export: { webm: false, gif: false, cover: false, mp3: false },
  brand: { enabled: false, handle: '@junction' },
  format: { aspect: '9:16', hd: false, fit: 'crop', speed: 1, compact: false },
  cta: { enabled: false, text: 'Пиши в директ!', seconds: 2.5 },
  logo: { enabled: false, position: 'tr', size: 0.18, opacity: 0.9 },
};

export const PRESETS = [
  {
    id: 'tiktok', name: 'TikTok жовтий', note: 'Обводка, слова по черзі, свайпи',
    cfg: { font: 'montserrat', text: { color: '#FFD60A', style: 'outline', size: 'l', position: 'center', upper: true }, anim: 'words',
      transition: { type: 'slideup', duration: 0.35 }, fx: { grade: 'vivid' }, audio: { sfxTransition: 'whoosh', sfxText: 'pop' } },
  },
  {
    id: 'hype', name: 'Хайп', note: 'Зум, тряска, бас, прогрес-бар',
    cfg: { font: 'unbounded', text: { color: '#FFFFFF', style: 'box', boxColor: '#6A1FB0', size: 'm', position: 'top', upper: true }, anim: 'pop',
      transition: { type: 'zoomin', duration: 0.3 }, fx: { grade: 'punchy', hookZoom: true, hookShake: true, progress: true },
      audio: { sfxHook: 'bass', sfxTransition: 'glitch', sfxText: 'pop' } },
  },
  {
    id: 'cinema', name: 'Кіно', note: 'Вузький шрифт, віньєтка, зерно',
    cfg: { font: 'oswald', text: { color: '#FFFFFF', style: 'shadow', size: 'm', position: 'bottom', upper: true }, anim: 'fade',
      transition: { type: 'fadeblack', duration: 0.6 }, fx: { grade: 'cinematic', vignette: true, grain: true },
      audio: { sfxTransition: 'whoosh', sfxHook: 'riser' } },
  },
  {
    id: 'minimal', name: 'Мінімал', note: 'Чисто, мʼякі переходи',
    cfg: { font: 'manrope', text: { color: '#FFFFFF', style: 'shadow', size: 's', position: 'center', upper: false }, anim: 'fade',
      transition: { type: 'fade', duration: 0.5 }, fx: { grade: 'matte' }, audio: { sfxTransition: 'none', sfxText: 'none', sfxHook: 'none' } },
  },
  {
    id: 'junction', name: 'Junction', note: 'Фірмові фіолетовий і зелений',
    cfg: { font: 'montserrat', text: { color: '#FFFFFF', style: 'box', boxColor: '#6A1FB0', size: 'm', position: 'top', upper: false }, anim: 'pop',
      transition: { type: 'smoothleft', duration: 0.4 }, fx: { grade: 'vivid', progress: true, progressColor: '#3DDC97' },
      audio: { sfxTransition: 'swoosh', sfxText: 'pop' }, cta: { enabled: true } },
  },
];
