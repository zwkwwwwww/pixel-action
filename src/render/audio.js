// 音频层：WebAudio 播放（手势后初始化）+ BGM 循环 + 静音 + 取证计数。
// 音频缺失时整个模块静默降级，绝不影响可玩性。

export const AUDIO_STATE = {
  ctx: null,
  master: null,
  buffers: new Map(),
  loaded: 0,
  failed: [],
  total: 0,
  bgm: null,
  muted: false,
  played: [],
};

const SFX = ['sfx_swing', 'sfx_hit', 'sfx_bow', 'sfx_dodge', 'sfx_special', 'sfx_death', 'sfx_victory'];

export async function initAudio() {
  if (AUDIO_STATE.ctx) return AUDIO_STATE;
  const Ctx = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!Ctx) return AUDIO_STATE;
  try {
    const ctx = new Ctx();
    AUDIO_STATE.ctx = ctx;
    AUDIO_STATE.master = ctx.createGain();
    AUDIO_STATE.master.gain.value = 0.55;
    AUDIO_STATE.master.connect(ctx.destination);

    const manifest = await fetch('assets/audio/manifest.json', { cache: 'no-cache' }).then((r) => {
      if (!r.ok) throw new Error(`manifest ${r.status}`);
      return r.json();
    });
    AUDIO_STATE.total = manifest.length;
    await Promise.all(manifest.map(async (m) => {
      try {
        const buf = await fetch(`assets/audio/${m.file}`).then((r) => {
          if (!r.ok) throw new Error(String(r.status));
          return r.arrayBuffer();
        });
        AUDIO_STATE.buffers.set(m.id, await ctx.decodeAudioData(buf));
        AUDIO_STATE.loaded++;
      } catch {
        AUDIO_STATE.failed.push(m.id);
      }
    }));
  } catch (e) {
    AUDIO_STATE.failed.push(`init:${e.message}`);
  }
  return AUDIO_STATE;
}

export function playSfx(id, { volume = 1, rate = 1 } = {}) {
  const s = AUDIO_STATE;
  if (!s.ctx || s.muted) return;
  if (s.ctx.state === 'suspended') s.ctx.resume().catch(() => {});
  const buf = s.buffers.get(id);
  if (!buf) return;
  const src = s.ctx.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = rate;
  const g = s.ctx.createGain();
  g.gain.value = volume;
  src.connect(g);
  g.connect(s.master);
  src.start();
  s.played.push(id);
  if (s.played.length > 200) s.played.shift();
}

export function playBgm(id, { volume = 0.5 } = {}) {
  const s = AUDIO_STATE;
  if (!s.ctx || s.bgm === id) return;
  stopBgm();
  const buf = s.buffers.get(id);
  if (!buf) return;
  const src = s.ctx.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  const g = s.ctx.createGain();
  g.gain.value = volume;
  src.connect(g);
  g.connect(s.master);
  src.start();
  s.bgm = id;
  s.bgmNode = src;
}

export function stopBgm() {
  const s = AUDIO_STATE;
  if (s.bgmNode) {
    try { s.bgmNode.stop(); } catch { /* 已停止 */ }
    s.bgmNode = null;
  }
  s.bgm = null;
}

export function toggleMute() {
  const s = AUDIO_STATE;
  s.muted = !s.muted;
  if (s.master) s.master.gain.value = s.muted ? 0 : 0.55;
  return s.muted;
}

export function audioSnapshot() {
  const s = AUDIO_STATE;
  return {
    ctxState: s.ctx ? s.ctx.state : 'none',
    loaded: s.loaded,
    failed: s.failed,
    bgm: s.bgm,
    muted: s.muted,
    playedCount: s.played.length,
    played: [...new Set(s.played)],
  };
}

export { SFX };
