// Розпізнавання мови (Whisper) у окремому потоці браузера, щоб сторінка не зависала.
import { pipeline, env } from './vendor/transformers/transformers.min.js';

env.allowLocalModels = false;
env.backends.onnx.wasm.wasmPaths = new URL('./vendor/transformers/', import.meta.url).href;
env.backends.onnx.wasm.numThreads = 1;

const MODELS = {
  base: { id: 'onnx-community/whisper-base', dtype: { encoder_model: 'fp32', decoder_model_merged: 'q8' } },
  small: { id: 'onnx-community/whisper-small', dtype: { encoder_model: 'q8', decoder_model_merged: 'q8' } },
};

let asr = null;
let loaded = null;

async function load(model, id) {
  if (asr && loaded === model) return asr;
  const m = MODELS[model] || MODELS.base;
  const files = {};
  const progress_callback = (p) => {
    if (p.status === 'progress' && p.total) {
      files[p.file] = [p.loaded, p.total];
      const all = Object.values(files);
      const done = all.reduce((s, f) => s + f[0], 0);
      const total = all.reduce((s, f) => s + f[1], 0);
      self.postMessage({ id, type: 'loading', loaded: done, total });
    }
  };
  try {
    asr = await pipeline('automatic-speech-recognition', m.id, { dtype: m.dtype, device: 'wasm', progress_callback });
  } catch (e) {
    // some model versions ship only quantized files
    asr = await pipeline('automatic-speech-recognition', m.id, { dtype: 'q8', device: 'wasm', progress_callback });
  }
  loaded = model;
  return asr;
}

self.onmessage = async ({ data }) => {
  const { id, audio, model, language } = data;
  try {
    const run = await load(model, id);
    self.postMessage({ id, type: 'working' });
    const out = await run(audio, {
      language: language === 'auto' ? null : language,
      task: 'transcribe',
      return_timestamps: true,
      chunk_length_s: 30,
      stride_length_s: 5,
    });
    self.postMessage({ id, type: 'done', text: out.text, chunks: out.chunks || [] });
  } catch (e) {
    self.postMessage({ id, type: 'error', message: String((e && e.message) || e) });
  }
};
