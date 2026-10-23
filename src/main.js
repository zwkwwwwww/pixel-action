// 《锈月回响》入口：Phase 1 —— 色块版可玩（真实美术在 Phase 2/3 接入）。
// 逻辑固定 60fps 步进；渲染只读世界状态。
import { computeViewport } from './render/scale.js';
import { dirFromKeys } from './core/input.js';
import { createWorld, step } from './core/world.js';
import { WORLD } from './core/actor.js';
import { createLevel, updateLevel, cameraLimit } from './core/level.js';
import { STAGES } from './core/stages.js';
import { enemyThink } from './core/ai.js';
import { ATTACKS, CHARGE } from './core/attacks.js';
import { loadSprites, drawActorSprite } from './render/sprites.js';
import { drawText, textWidth } from './render/pixelfont.js';
import { createEffects, spawnHitFx, updateEffects, spawnTelegraph } from './core/effects.js';
import { hitVariation, nextCombo } from './core/hit-rhythm.js';
import { initAudio, playSfx, playBgm, stopBgm, toggleMute, audioSnapshot } from './render/audio.js';
import { formatTime, loadRecords, saveClear } from './core/records.js';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d', { alpha: false });
ctx.imageSmoothingEnabled = false;

const VIEW_W = 480;
const VIEW_H = 270;
const GROUND_TOP = 150;
const HERO_H = 40;
const HERO_W = 18;

const keys = { left: false, right: false, up: false, down: false };
// 蓄力：记录攻击键按下的帧号（-1 = 未按住）
const charge = { startFrame: -1 };
const KEYMAP = {
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
  ArrowUp: 'up', KeyW: 'up',
  ArrowDown: 'down', KeyS: 'down',
};
// 难度：影响敌人伤害倍率与玩家血量。默认 NORMAL，和之前的数值完全一致。
const DIFFICULTIES = [
  { id: 'easy',   label: 'EASY',   dmgMul: 0.6, hpMul: 1.5, key: 'Digit1' },
  { id: 'normal', label: 'NORMAL', dmgMul: 1.0, hpMul: 1.0, key: 'Digit2' },
  { id: 'hard',   label: 'HARD',   dmgMul: 1.5, hpMul: 0.75, key: 'Digit3' },
];
const ACTION_KEYS = { KeyJ: 'attack', KeyK: 'dodge', KeyL: 'special', KeyU: 'throw', Space: 'jump' };

const world = createWorld({
  player: { x: 120, y: 41, hp: 240, maxHp: 240, ammo: 5 },
  enemies: [],
  enemyThink,
});
const level0 = createLevel(STAGES[0]);
let level = level0;
const fx = createEffects();

const state = {
  ready: false,
  world,
  level,
  fx,
  viewport: computeViewport(innerWidth, innerHeight),
  camX: 0,
  frame: 0,
  shake: 0,
  flash: 0,
  lastEvents: [],
  viewW: VIEW_W,
  viewH: VIEW_H,
  drawnActors: 0,
  won: false,
  lost: false,
  paused: false,
  runFrames: 0,
  stageIndex: 0,
  stageBanner: null,
  stageClear: null,
  maxCombo: 0,
  difficulty: DIFFICULTIES[1],   // 默认 NORMAL
  // 新手引导：开局前 8 秒显示关键技巧提示，只显示一次
  tipFrames: 0,
  tipDone: false,
  result: null,
  records: loadRecords(),
  mode: 'title', // title | play
  art: { loaded: [], missing: [], drawnSprites: 0 },
};

// —— 精灵资产（Phase 2/3 管线产物）：缺失时自动回退色块，不阻塞可玩 ——
const SHEETS = {};
const BACKGROUNDS = {};
// 精灵表缺失时的兜底映射（盾兵已有专属表，这里留着防止加载失败时整个渲染崩）
// 必须定义在模块顶层：渲染循环在另一个函数作用域里，取不到 IIFE 内的局部变量
const SHEET_ALIAS = { shield: 'brute' };
const sheetOf = (kind) => SHEETS[kind] || SHEETS[SHEET_ALIAS[kind]] || null;

const prevPos = new Map();
(async () => {
  const want = ['hero', 'grunt', 'brute', 'ranger', 'shield', 'boss', 'boss_warden', 'boss_berserker'];
  await Promise.all(want.map(async (name) => {
    try {
      SHEETS[name] = await loadSprites(`assets/sprites/${name}`);
      state.art.loaded.push(name);
    } catch {
      state.art.missing.push(name);
    }
  }));
  const bgWant = ['bg_level', 'bg_boss', 'bg_title', 'bg_stage2'];
  await Promise.all(bgWant.map(async (name) => {
    try {
      const img = new Image();
      img.src = `assets/bg/${name}.png`;
      await img.decode();
      BACKGROUNDS[name] = img;
    } catch { /* 背景缺失就退回程序化背景 */ }
  }));
})();

// ——— 音频事件：状态迁移时才播，避免每帧重复触发 ———
const prevAudio = { state: '', attack: null, dead: 0, boss: false, won: false, lost: false, swingFired: false };
// 连打节奏：0.7s 内的连续命中算同一连段（连段越长音高越高，每第 4 下给一记重音）
let hitCombo = 0;
let lastHitAt = 0;
function audioEvents() {
  const p = world.player;
  // 普攻不再有任何挥击/破空声：打空是安静的，命中只有撞击音（反馈更干净）。
  // 必杀是独立的能量招式，保留它自己的音效，且同样在判定帧触发。
  if (p.state !== 'attack' || !p.attack || prevAudio.attack !== p.attack) prevAudio.swingFired = false;
  if (p.state === 'attack' && p.attack && !prevAudio.swingFired) {
    const def = ATTACKS[p.attack];
    if (def && p.stateFrame >= def.startup && p.attack === 'special') {
      playSfx('sfx_special', { volume: 0.8 });
      prevAudio.swingFired = true;
    }
  }
  if (p.state === 'dodge' && prevAudio.state !== 'dodge') playSfx('sfx_dodge', { volume: 0.55 });
  // 起跳音：二段跳也播（音高略抬，区分第一次）
  if (p.state === 'jump' && prevAudio.state !== 'jump') {
    playSfx('sfx_jump', { volume: 0.5, rate: p.airJumps < WORLD.JUMP.maxAirJumps ? 1.12 : 1 });
  }

  const dead = world.enemies.filter((e) => e.dead).length;
  // 敌人死亡的"啊——"由击杀事件触发（见 hit 处理），这里不再重复播 sfx_death

  if (level.bossSpawned && !prevAudio.boss) {
    playBgm('bgm_boss', { volume: 0.34 });
  }
  if (level.won && !prevAudio.won) {
    stopBgm();
    playSfx('sfx_victory', { volume: 0.9 });
  }
  if (world.player.dead && !prevAudio.lost) {
    stopBgm();
    playSfx('sfx_death', { volume: 0.9 });
  }
  prevAudio.state = p.state;
  prevAudio.attack = p.attack;
  prevAudio.dead = dead;
  prevAudio.boss = level.bossSpawned;
  prevAudio.won = level.won;
  prevAudio.lost = world.player.dead;
}

function applyViewport() {  const v = computeViewport(innerWidth, innerHeight);
  state.viewport = v;
  canvas.style.width = `${v.cssW}px`;
  canvas.style.height = `${v.cssH}px`;
}
addEventListener('resize', applyViewport);
applyViewport();

addEventListener('keydown', (e) => {
  ensureAudio();
  if (state.mode === 'title') {
    const picked = DIFFICULTIES.find((d) => d.key === e.code);
    if (picked) {
      state.difficulty = picked;
      // 立刻把玩家血量按难度缩放（进游戏前选，进游戏后生效）
      world.player.maxHp = Math.round(240 * picked.hpMul);
      world.player.hp = world.player.maxHp;
      world.dmgMul = picked.dmgMul;
      e.preventDefault();
      return;
    }
    if (e.code === 'Enter' || e.code === 'Space' || e.code === 'KeyJ') {
      state.mode = 'play';
      if (!state.tipDone) state.tipFrames = 480;   // 8 秒
      playBgm('bgm_battle', { volume: 0.32 });
      e.preventDefault();
    }
    return;
  }
  if (e.code === 'Escape' && !state.won && !state.lost) {
    state.paused = !state.paused;
    e.preventDefault();
    return;
  }
  if (state.paused) {
    if (e.code === 'KeyR') location.reload();
    if (e.code === 'KeyM') { toggleMute(); state.audio = audioSnapshot(); }
    return;
  }
  const k = KEYMAP[e.code];
  if (k) { keys[k] = true; e.preventDefault(); return; }
  if (e.code === 'KeyM') { toggleMute(); state.audio = audioSnapshot(); return; }
  const action = ACTION_KEYS[e.code];
  if (action) {
    if (world.player.dead || level.won) return;
    // 攻击键按下时不立即出手，先记录「开始按住」——松手时按按住时长决定轻击/重斩
    if (action === 'attack') {
      if (charge.startFrame < 0) charge.startFrame = state.frame;
      e.preventDefault();
      return;
    }
    world.press(action);
    e.preventDefault();
  }
});

addEventListener('keyup', (e) => {
  const action = ACTION_KEYS[e.code];
  if (action !== 'attack') return;
  if (charge.startFrame < 0 || state.mode !== 'play' || state.paused) {
    charge.startFrame = -1;
    return;
  }
  const held = state.frame - charge.startFrame;
  charge.startFrame = -1;
  if (world.player.dead || level.won) return;
  // 按住够久 → 蓄力重斩；否则是普通轻击
  world.press(held >= CHARGE.frames ? 'heavy' : 'attack');
});

// 音频必须等一次用户手势才能启动（浏览器自动播放策略）
let audioReady = false;
function ensureAudio() {
  if (audioReady) return;
  audioReady = true;
  initAudio().then(() => {
    state.audio = audioSnapshot();
    // 解码完成时如果已经在游戏里，补上 BGM（Enter 时音频往往还没加载完）
    if (state.mode === 'play') playBgm(level.bossSpawned ? 'bgm_boss' : 'bgm_battle', { volume: 0.32 });
  });
}
addEventListener('keyup', (e) => {
  const k = KEYMAP[e.code];
  if (k) { keys[k] = false; e.preventDefault(); }
});
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

// ——— 固定步长逻辑 ———
const STEP_MS = 1000 / WORLD.FPS;
let acc = 0;
let last = performance.now();

/** 进入下一关：重建关卡、清场、把玩家放回起点（用时跨关累计，不重置 runFrames）。 */
function advanceStage() {
  state.stageIndex++;
  level = createLevel(STAGES[state.stageIndex]);
  state.level = level;
  const p = world.player;
  p.x = 120; p.y = 41; p.z = 0;
  p.vx = 0; p.vy = 0; p.vz = 0;
  p.facing = 1;
  p.hp = p.maxHp;
  p.meter = 0;
  p.ammo = 5;          // 换关补满飞刀
  p.z = 0; p.airJumps = 0;
  p.state = 'idle'; p.stateFrame = 0;
  p.attack = null; p.queued = null; p.hurtTime = 0; p.invuln = 0; p.dead = false;
  p.hitTargets.clear();
  world.projectiles.length = 0;
  world.enemies.length = 0;
  world.actors.length = 0;
  world.actors.push(p);
  world.projectiles.length = 0;
  world.events.length = 0;
  world.hitstop = 0;
  world.frame = 0;
  fx.numbers.length = 0;
  fx.particles.length = 0;
  prevPos.clear();
  state.camX = 0;
  state.won = false;
  state.lost = false;
  state.result = null;
  state.stageBanner = { text: `STAGE ${level.def.id}  ${level.def.name}`, frames: 150 };
  state.stageClear = null;
  playBgm('bgm_battle', { volume: 0.32 });
}

function logicStep() {
  world.dir = dirFromKeys(keys);
  step(world);
  updateLevel(world, level, state.camX);
  state.frame++;
  state.runFrames++;
  if (state.stageBanner && state.stageBanner.frames > 0) state.stageBanner.frames--;
  if (state.tipFrames > 0) {
    state.tipFrames--;
    if (state.tipFrames === 0) state.tipDone = true;
  }
  state.won = level.won;
  state.lost = world.player.dead;
  // 通关结算：还有下一关就先进「STAGE n CLEAR」停顿 2 秒，最后一关才写纪录
  if (state.won) {
    if (state.stageIndex < STAGES.length - 1) {
      if (!state.stageClear) {
        state.stageClear = {
          text: `STAGE ${level.def.id} CLEAR`,
          timeMs: (state.runFrames / WORLD.FPS) * 1000,
          // 墙钟计时：帧计数会被「卡顿后一次补 5 步」追平，2 秒会变成 0.4 秒
          endsAt: performance.now() + 2000,
        };
        world.events.length = 0;
        state.shake = 0;
        // 胜利音由 audioEvents 统一播（level.won 迁移时），这里不重复
      }
    } else if (!state.result) {
      const timeMs = (state.runFrames / WORLD.FPS) * 1000;
      const p = world.player;
      let store = null;
      try { store = globalThis.localStorage; } catch { /* 隐私模式 */ }
      const saved = saveClear(store, { timeMs, hp: p.hp, maxHp: p.maxHp });
      state.records = saved.records;
      state.result = { timeMs, grade: saved.grade, isNewBest: saved.isNewBest };
    }
  }

  const evs = world.consumeEvents();
  for (const ev of evs) {
    if (ev.type === 'hit') {
      // 玩家被从背后打中：震屏更强、闪屏更红，让"后背空门"这件事有痛感
      const backstab = ev.targetSide === 'player' && ev.fromBehind;
      state.shake = Math.min(backstab ? 9 : 6, state.shake + (backstab ? 5 : 3));
      state.flash = Math.max(state.flash, ev.killed ? 0.5 : (backstab ? 0.4 : 0.25));
      spawnHitFx(fx, ev);
      // 玩家挨打 → "呃"；打中敌人 → 金属撞击；击杀 → 追加"啊——"
      if (ev.targetSide === 'player') {
        playSfx('sfx_hurt', { volume: 0.9, rate: 0.96 + Math.random() * 0.08 });
      } else {
        const nowMs = performance.now();
        hitCombo = nextCombo(hitCombo, nowMs, lastHitAt);
        lastHitAt = nowMs;
        // 连击计数（HUD 与结算用）：hitCombo 从 0 起算，显示时 +1
        if (hitCombo + 1 > state.maxCombo) state.maxCombo = hitCombo + 1;
        const variation = hitVariation(hitCombo);
        const heavy = ev.killed || variation.heavy;
        // 飞刀命中用专属金属音，和近战刀砍铁甲区分开
        const isKnife = ev.attack === 'throw';
        // 空连：音高抬高，和地面命中区分开
        const airRate = ev.airHit ? 1.12 : 1;
        if (ev.blocked) {
          // 被盾牌挡住：金属刮擦音 + 飘 BLOCK，让玩家知道"该绕后了"
          playSfx('sfx_knife', { volume: 0.55, rate: 0.72 });
          fx.numbers.push({
            x: ev.x, y: ev.y, z: 30, vz: 0.7,
            text: 'BLOCK', age: 0, life: 36,
            color: '#a9b8cc', scale: 1, outline: '#0a0d12',
          });
          state.shake = Math.min(6, state.shake + 1);
        } else if (isKnife) {
          playSfx('sfx_knife', { volume: 0.85, rate: 0.98 + Math.random() * 0.05 });
        } else {
          playSfx(heavy ? 'sfx_hit_heavy' : 'sfx_hit', {
            volume: heavy ? 1.0 : 0.9,
            rate: variation.rate * airRate + Math.random() * 0.015,
          });
        }
        if (ev.airHit) {
          // 空连飘字：给玩家一个"我打在空中了"的即时反馈
          fx.numbers.push({
            x: ev.x,
            y: ev.y,
            z: 34,
            vz: 1.1,
            text: 'AIR',
            age: 0,
            life: 34,
            color: '#9fe0ff',
            scale: 1,
            outline: '#0a0d12',
          });
          state.shake = Math.min(8, state.shake + 2);
        }
      }
    } else if (ev.type === 'shoot') {
      playSfx('sfx_bow', { volume: 0.55 });
    } else if (ev.type === 'telegraph') {
      // Boss 起手：地面预警圈，前摇结束前收缩到中心
      spawnTelegraph(fx, {
        x: ev.x, y: ev.y, r: ev.radius,
        life: Math.max(6, ev.life),
        color: ev.color,
      });
    } else if (ev.type === 'bossPhase') {
      // Boss 进新阶段：闪一下 + 短震屏，给玩家它变强了的明确信号
      state.flash = Math.max(state.flash, 0.35);
      state.shake = Math.min(8, state.shake + 4);
      playSfx('sfx_special', { volume: 0.45, rate: 0.8 });
      state.bossPhaseToast = { phase: ev.phase, until: performance.now() + 1200 };
    } else if (ev.type === 'pickupBox') {
      // 补给箱：绿色 +HP 飘字 + 轻快拾取音
      fx.numbers.push({
        x: ev.x, y: ev.y, z: 26, vz: 0.85,
        text: `+${ev.heal}`, age: 0, life: 46,
        color: '#7cf29a', scale: 1, outline: '#0a0d12',
      });
      playSfx('sfx_pickup', { volume: 0.8 });
    } else if (ev.type === 'bossDown') {
      // Boss 倒下：白闪 + 强震屏 + 慢动作感（后续 1.2s 由 level 的 bossDeathFrames 控制）
      state.flash = 0.75;
      state.shake = 9;
      playSfx('sfx_death', { volume: 1.0, rate: 0.72 });
      fx.numbers.push({
        x: ev.x, y: ev.y, z: 60, vz: 0.35,
        text: 'DOWN', age: 0, life: 90,
        color: '#ffd166', scale: 3, outline: '#0a0d12',
      });
    } else if (ev.type === 'guardBreak') {
      // 破防：金色 BREAK + 强震屏 + 重击音，是"绕后/蓄力"打法的高光时刻
      fx.numbers.push({
        x: ev.x, y: ev.y, z: 34, vz: 1.0,
        text: 'BREAK', age: 0, life: 46,
        color: '#ffd166', scale: 2, outline: '#0a0d12',
      });
      state.shake = Math.min(9, state.shake + 5);
      playSfx('sfx_hit_heavy', { volume: 1.0, rate: 0.7 });
    } else if (ev.type === 'waveClear') {
      // 一波清完：飘 WAVE CLEAR + 回血/补弹提示
      state.waveToast = { wave: ev.wave, total: ev.total, until: performance.now() + 1400 };
      fx.numbers.push({
        x: ev.x, y: ev.y, z: 34, vz: 0.9,
        text: '+AMMO', age: 0, life: 44,
        color: '#9fe0ff', scale: 1, outline: '#0a0d12',
      });
      playSfx('sfx_pickup', { volume: 0.75, rate: 0.92 });
    } else if (ev.type === 'pickup') {
      // 击杀持刀敌人补给飞刀：飘一个 +1 KNIFE，让玩家知道资源进账
      fx.numbers.push({
        x: ev.x,
        y: ev.y,
        z: 30,
        vz: 0.9,
        text: '+1',
        age: 0,
        life: 40,
        color: '#9fe0ff',
        scale: 1,
        outline: '#0a0d12',
      });
      playSfx('sfx_pickup', { volume: 0.7 });
    }
    state.lastEvents.push(ev);
  }
  updateEffects(fx);
  audioEvents();
  while (state.lastEvents.length > 40) state.lastEvents.shift();

  // 相机：波次进行中锁死在触发机位（屏幕右缘 = 关卡边界）；清完后恢复阻尼跟随
  const limit = cameraLimit(level);
  const maxCam = Math.max(0, limit - VIEW_W);
  const look = (world.player.facing || 1) * 26;
  let target = Math.max(0, Math.min(maxCam, world.player.x + look - VIEW_W * 0.45));
  if (level.camLockX != null) target = level.camLockX;
  state.camTarget = target;
  if (!state.camInit) {
    state.camX = target;
    state.camInit = true;
  } else {
    state.camX += (target - state.camX) * 0.14;
    state.camX = Math.max(0, Math.min(maxCam, state.camX));
  }
}

function drawBlock(x, y, w, h, color, outline = '#0a0d12') {
  ctx.fillStyle = outline;
  ctx.fillRect(Math.round(x) - 1, Math.round(y) - 1, w + 2, h + 2);
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), w, h);
  state.drawnActors++;
}

const ENEMY_COLORS = { grunt: '#5ec27a', brute: '#d08a3e', ranger: '#9b7bd8', boss: '#d2483f' };
// 血条要挂在「精灵头顶」，用契约里的可见高度而不是方块尺寸
// 各角色精灵高度（血条/阴影定位用）。缺项会回退到错误高度 ——
// 之前 boss_warden / boss_berserker 就没登记，血条画在身体中间。
/**
 * 飞行敌人：纯 Canvas 程序化绘制。
 * 造型 = 深色菱形身体 + 一对扇动的翅膀 + 两只红眼 + 地面小影子。
 * 为什么不用精灵表：飞行单位需要"悬空 + 扇翅"的连续动态，
 * 程序化能立刻做到，而且改参数（翅幅/频率）不用重跑管线。
 */
/**
 * 连击评级：把连段长度翻译成字母等级。
 * 只在连段达到一定长度后才显示，避免每一下都闪一个 D 显得吵。
 */
function comboGrade(count) {
  if (count >= 20) return { label: 'S', color: '#ffd166' };
  if (count >= 14) return { label: 'A', color: '#ff9a5c' };
  if (count >= 9) return { label: 'B', color: '#9fe0ff' };
  if (count >= 5) return { label: 'C', color: '#a9c8ff' };
  if (count >= 3) return { label: 'D', color: '#8fa4bd' };
  return null;
}

function drawFlyer(ctx, a, sx, sy) {
  const t = (a.hoverT || 0) * 0.35;
  const flap = Math.sin(t);                 // 翅幅 -1..1
  const cx = Math.round(sx);
  const cy = Math.round(sy);
  const hurt = a.state === 'hurt' || a.state === 'dead';

  // 地面影子（提示它悬在多高）
  const shadowW = Math.max(8, 20 - Math.abs(a.z || 0) * 0.12);
  ctx.fillStyle = 'rgba(0,0,0,.30)';
  ctx.fillRect(cx - Math.round(shadowW / 2), cy - 2, Math.round(shadowW), 3);

  const body = hurt ? '#ffffff' : '#4a3a5e';
  const wing = hurt ? '#ffffff' : '#6b5580';
  const dark = '#140f1c';

  // 翅膀：以身体为中心左右张开，flap 控制高度
  const wingDrop = Math.round(flap * 4);
  ctx.fillStyle = dark;
  ctx.fillRect(cx - 17, cy - 13 - wingDrop, 12, 3);
  ctx.fillRect(cx + 5, cy - 13 - wingDrop, 12, 3);
  ctx.fillStyle = wing;
  ctx.fillRect(cx - 16, cy - 12 - wingDrop, 10, 7);
  ctx.fillRect(cx + 6, cy - 12 - wingDrop, 10, 7);

  // 身体：菱形
  ctx.fillStyle = dark;
  ctx.fillRect(cx - 6, cy - 14, 12, 14);
  ctx.fillStyle = body;
  ctx.fillRect(cx - 5, cy - 13, 10, 8);
  ctx.fillRect(cx - 3, cy - 5, 6, 5);

  // 红眼（朝面向方向偏移，让朝向可读）
  ctx.fillStyle = '#ff5252';
  const eyeX = cx + (a.facing > 0 ? 2 : -4);
  ctx.fillRect(eyeX, cy - 11, 2, 2);
  ctx.fillRect(eyeX + (a.facing > 0 ? -4 : 4), cy - 11, 2, 2);
}

const SPRITE_H = {
  hero: 56, grunt: 46, brute: 52, ranger: 48, shield: 52,
  boss: 112, boss_warden: 112, boss_berserker: 112,
};
// 小怪/精英头顶血条：保持显示（上一轮曾误判成「那根红线」而关闭，已恢复；想隐藏改成 false）
const SHOW_ENEMY_HP = true;

/** 确定性哈希：地面砖块的明暗不能用 Math.random（会每帧闪烁）。 */
function hash2(a, b) {
  let h = (a * 374761393 + b * 668265263) >>> 0;
  h = (h ^ (h >>> 13)) * 1274126177 >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * 程序化鹅卵石地面：透视用的「行越高越矮、砖越小、滚动越慢」。
 * 背景图负责天际线，这块地面负责让角色真的「踩在地上」。
 */
function drawGround(cam) {
  ctx.fillStyle = '#141b24';
  ctx.fillRect(0, GROUND_TOP, VIEW_W, VIEW_H - GROUND_TOP);

  // 地平线暗带：把背景与地面的接缝藏起来
  const hz = ctx.createLinearGradient(0, GROUND_TOP, 0, GROUND_TOP + 22);
  hz.addColorStop(0, 'rgba(4,6,10,.85)');
  hz.addColorStop(1, 'rgba(4,6,10,0)');
  ctx.fillStyle = hz;
  ctx.fillRect(0, GROUND_TOP, VIEW_W, 22);

  const rows = 13;
  let y = GROUND_TOP + 1;
  for (let r = 0; r < rows; r++) {
    const t = r / (rows - 1);
    const rh = 4 + t * 11;
    const bw = 11 + t * 19;
    const speed = 0.55 + t * 0.45;
    const off = -((cam * speed) % bw);
    for (let x = off - bw; x < VIEW_W + bw; x += bw) {
      const shade = hash2(r, Math.round((x + cam * speed) / bw)) % 3;
      ctx.fillStyle = ['#151d28', '#18222e', '#121923'][shade];
      ctx.fillRect(Math.round(x) + 1, Math.round(y), Math.max(1, Math.ceil(bw) - 2), Math.max(1, Math.ceil(rh) - 1));
      // 砖块上沿高光：薄薄 1px 就能让地面「有厚度」
      if (rh > 6) {
        ctx.fillStyle = 'rgba(120,160,200,.06)';
        ctx.fillRect(Math.round(x) + 1, Math.round(y), Math.max(1, Math.ceil(bw) - 2), 1);
      }
    }
    y += rh;
    if (y > VIEW_H) break;
  }
}

/** 标题画面：背景取中央 480×270，标题用点阵字排两行。 */
function drawTitle() {
  const bg = BACKGROUNDS.bg_title || BACKGROUNDS.bg_level;
  if (bg) {
    ctx.drawImage(bg, 240, 0, 480, 270, 0, 0, 480, 270);
    ctx.fillStyle = 'rgba(5,7,12,.52)';
    ctx.fillRect(0, 0, 480, 270);
  } else {
    ctx.fillStyle = '#0b1020';
    ctx.fillRect(0, 0, 480, 270);
  }

  const line1 = 'ECHOES OF THE';
  const line2 = 'RUSTED MOON';
  drawText(ctx, line1, (VIEW_W - textWidth(line1, 3)) / 2, 58, '#d8c48a', 3, '#0a0d12');
  drawText(ctx, line2, (VIEW_W - textWidth(line2, 4)) / 2, 92, '#e8dcc0', 4, '#0a0d12');
  const sub = 'A 2.5D PIXEL ACTION SLICE';
  drawText(ctx, sub, (VIEW_W - textWidth(sub, 1)) / 2, 140, '#8fa6c2', 1, '#05070b');

  const pulse = 0.35 + 0.65 * Math.abs(Math.sin(state.frame / 34));
  ctx.globalAlpha = pulse;
  const press = 'PRESS ENTER TO START';
  drawText(ctx, press, (VIEW_W - textWidth(press, 1)) / 2, 196, '#ffd166', 1, '#05070b');
  ctx.globalAlpha = 1;

  if (state.records.bestTimeMs !== null) {
    const best = `BEST ${formatTime(state.records.bestTimeMs)}   CLEARS ${state.records.clears}`;
    drawText(ctx, best, (VIEW_W - textWidth(best, 1)) / 2, 178, '#9fb4d0', 1, '#05070b');
  }

  // 难度选择：高亮当前选项，1/2/3 切换
  const diffLine = DIFFICULTIES
    .map((d, i) => (d === state.difficulty ? `[${d.label}]` : ` ${d.label} `))
    .join('  ');
  const dw = textWidth(diffLine, 1);
  drawText(ctx, diffLine, (VIEW_W - dw) / 2, 196, '#ffd166', 1, '#05070b');
  const diffHint = '1 / 2 / 3  SELECT DIFFICULTY';
  drawText(ctx, diffHint, (VIEW_W - textWidth(diffHint, 1)) / 2, 210, '#6f88a6', 1, '#05070b');

  const keys = 'WASD MOVE   J ATTACK   K ROLL   L SPECIAL   U KNIFE   SPACE JUMP   M MUTE';
  ctx.fillStyle = 'rgba(5,7,12,.6)';
  ctx.fillRect(0, 226, VIEW_W, 14);
  drawText(ctx, keys, (VIEW_W - textWidth(keys, 1)) / 2, 232, '#6f88a6', 1, '#05070b');
}

function draw() {
  if (state.mode === 'title') { drawTitle(); return; }
  // 相机取整一次：所有图层用同一个整数偏移，避免背景与角色相对抖动
  const cam = Math.round(state.camX);
  const shakeX = (Math.random() - 0.5) * state.shake;
  const shakeY = (Math.random() - 0.5) * state.shake;

  const stageBg = level.def.bg || (level.def.id === 2 ? 'bg_stage2' : 'bg_level');
  const bg = BACKGROUNDS[level.bossSpawned ? 'bg_boss' : stageBg] || BACKGROUNDS.bg_level;
  if (bg) {
    // 视差：960px 宽的背景在 2720px 的滚动距离里刚好走完 480px 的富余
    const px = Math.round(Math.min(480, cam * 0.176));
    ctx.drawImage(bg, -px, 0, 960, 270);
    // 压暗一层，让角色从背景里「跳」出来
    ctx.fillStyle = 'rgba(6,8,14,.30)';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  } else {
    const sky = ctx.createLinearGradient(0, 0, 0, GROUND_TOP);
    sky.addColorStop(0, '#0b1020');
    sky.addColorStop(0.7, '#232a3d');
    sky.addColorStop(1, '#4a3a35');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, VIEW_W, GROUND_TOP);
    ctx.fillStyle = '#c9a227';
    ctx.beginPath();
    ctx.arc(352 - cam * 0.12, 58, 24, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#0b1020';
    ctx.beginPath();
    ctx.arc(341 - cam * 0.12, 50, 22, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#161c28';
    for (let i = 0; i < 16; i++) {
      const wx = i * 140 + 30;
      const bx = wx - cam * 0.35;
      if (bx < -80 || bx > VIEW_W + 80) continue;
      const bh = 38 + ((i * 53) % 60);
      ctx.fillRect(Math.round(bx), GROUND_TOP - bh, 60, bh);
    }
  }

  drawGround(cam);

  // 车道线：让 2.5D 的纵深可读
  for (let i = 0; i <= 4; i++) {
    const y = GROUND_TOP + (WORLD.DEPTH_MAX * i) / 4;
    ctx.fillStyle = i === 0 || i === 4 ? 'rgba(120,160,200,.16)' : 'rgba(110,145,180,.07)';
    ctx.fillRect(0, Math.round(y), VIEW_W, 1);
  }

  // 关卡边界不再画任何竖线：波次进行中镜头锁定，屏幕右缘本身就是墙。

  ctx.save();
  ctx.translate(Math.round(shakeX), Math.round(shakeY));

  // —— 地面补给箱 ——
  // 画在角色之前（角色可以走过它），用"呼吸"缩放提示可交互
  for (const pk of level.pickups || []) {
    if (pk.taken) continue;
    const bx = Math.round(pk.x - cam);
    if (bx < -20 || bx > VIEW_W + 20) continue;
    const by = Math.round(GROUND_TOP + pk.y);
    const bob = Math.sin(state.frame * 0.08 + pk.x) * 1.5;
    const cy = Math.round(by - 6 + bob);
    // 影子
    ctx.fillStyle = 'rgba(0,0,0,.32)';
    ctx.fillRect(bx - 7, by - 1, 14, 3);
    // 箱体
    ctx.fillStyle = '#0a0d12';
    ctx.fillRect(bx - 8, cy - 9, 16, 13);
    ctx.fillStyle = '#3c6b4a';
    ctx.fillRect(bx - 7, cy - 8, 14, 11);
    // 箱盖高光 + 十字标记
    ctx.fillStyle = '#6fbe8a';
    ctx.fillRect(bx - 7, cy - 8, 14, 2);
    ctx.fillRect(bx - 1, cy - 6, 2, 6);
    ctx.fillRect(bx - 4, cy - 4, 8, 2);
  }

  // 深度排序：y 大的后画（更靠前）
  const drawables = [
    ...world.enemies.filter((e) => !e.dead || e.state === 'dead').map((e) => ({ a: e, kind: 'enemy' })),
    { a: world.player, kind: 'player' },
  ].sort((p, q) => p.a.y - q.a.y);

  for (const { a, kind } of drawables) {
    const sx = a.x - cam;
    if (sx < -80 || sx > VIEW_W + 80) continue;
    const sy = GROUND_TOP + a.y;
    const airborne = a.z > 0 ? a.z : 0;
    const p0 = prevPos.get(a.uid);
    const moving = p0 ? Math.hypot(a.x - p0[0], a.y - p0[1]) > 0.05 : false;
    prevPos.set(a.uid, [a.x, a.y]);

    if (kind === 'player') {
      const h = HERO_H;
      ctx.fillStyle = 'rgba(0,0,0,.35)';
      ctx.fillRect(Math.round(sx - 10), Math.round(sy - 3), 20, 4);
      ctx.globalAlpha = a.invuln > 0 ? 0.55 : 1;
      const drew = drawActorSprite(ctx, SHEETS.hero, a, sx, sy, moving);
      if (drew) state.art.drawnSprites++;
      if (!drew) {
        drawBlock(sx - HERO_W / 2, sy - h - airborne, HERO_W, h, a.state === 'attack' ? '#ff7a5c' : '#e0483c');
        ctx.fillStyle = '#ffd166';
        ctx.fillRect(Math.round(a.facing > 0 ? sx + HERO_W / 2 - 2 : sx - HERO_W / 2 - 2), Math.round(sy - h + 5), 4, 8);
      }
      ctx.globalAlpha = 1;
    } else {
      const size = a.kind === 'boss' ? 44 : 28;
      ctx.fillStyle = 'rgba(0,0,0,.35)';
      ctx.fillRect(Math.round(sx - size / 2), Math.round(sy - 3), size, 4);
      if (a.dead) {
        // 死亡动画播完后**冻结在最后一帧**（倒地姿势），不再压成灰色条——
        // 那根条在画面上就是一块"掉落的色块"。3 秒后开始淡出，避免尸体堆满地面。
        const fade = a.stateFrame <= 180 ? 1 : Math.max(0, 1 - (a.stateFrame - 180) / 60);
        if (fade > 0) {
          ctx.globalAlpha = 0.85 * fade;
          if (drawActorSprite(ctx, sheetOf(a.kind), a, sx, sy, false)) state.art.drawnSprites++;
          ctx.globalAlpha = 1;
        }
      } else {
        // 飞行敌人：暂无 Blender 模型，用程序化绘制（翅膀扇动 + 悬空）
        // 立刻能试玩法；等专属精灵表产出后删掉这个分支即可
        if (a.flyer) {
          drawFlyer(ctx, a, sx, sy - airborne);
          state.art.drawnSprites++;
        } else if (drawActorSprite(ctx, sheetOf(a.kind), a, sx, sy, moving)) {
          state.art.drawnSprites++;
        } else {
          drawBlock(
            sx - size / 2, sy - size - airborne, size, size,
            a.state === 'hurt' ? '#ffffff' : (ENEMY_COLORS[a.kind] || '#888'),
          );
        }
      }
      if (a.state === 'attack') {
        // 起手预警：头顶红色感叹号
        ctx.fillStyle = '#ff5252';
        ctx.fillRect(Math.round(sx) - 1, Math.round(sy - size - airborne - 12), 2, 7);
        ctx.fillRect(Math.round(sx) - 1, Math.round(sy - size - airborne - 3), 2, 2);
      }
    }

    // 小怪/精英头顶的血条默认不画：一根悬空红线会打断像素画面，
    // 战斗反馈改由受击闪白、伤害飘字、硬直动作承担；Boss 仍用屏幕底部血条。
    if (SHOW_ENEMY_HP && !a.dead && kind !== 'player') {
      const w = a.kind === 'boss' ? 64 : 22;
      const bx = Math.round(sx - w / 2);
      const topH = SPRITE_H[a.kind] || (String(a.kind).startsWith('boss') ? 112 : 48);
      const by = Math.round(sy - topH - airborne - 7);
      ctx.fillStyle = '#0a0d12';
      ctx.fillRect(bx - 1, by - 1, w + 2, 4);
      ctx.fillStyle = '#d2483f';
      ctx.fillRect(bx, by, Math.round((w * a.hp) / a.maxHp), 2);
    }
  }
  ctx.restore();

  // —— 箭（弓手投射物）：深色描边 + 亮色箭杆，保证在暗背景上也能看清 ——
  for (const pr of world.projectiles) {
    const ax = Math.round(pr.x - cam);
    const ay = Math.round(GROUND_TOP + pr.y - (pr.z || 0));
    if (ax < -16 || ax > VIEW_W + 16) continue;
    const dir = pr.vx >= 0 ? 1 : -1;
    if (pr.attack === 'throw') {
      // 飞刀：两帧交替模拟旋转，颜色偏冷，和弓手的箭区分开
      const spin = Math.floor(pr.age / 3) % 2;
      ctx.fillStyle = '#0a0d12';
      ctx.fillRect(ax - 4, ay - 4, 9, 9);
      ctx.fillStyle = '#cfe3ff';
      if (spin) ctx.fillRect(ax - 3, ay - 1, 7, 2);
      else ctx.fillRect(ax - 1, ay - 4, 2, 8);
      ctx.fillStyle = '#8fd4ff';
      ctx.fillRect(ax + dir * 4 - (dir > 0 ? 0 : 1), ay - 1, 2, 2);
      continue;
    }
    ctx.fillStyle = '#0a0d12';
    ctx.fillRect(ax - 5, ay - 1, 11, 3);
    ctx.fillStyle = '#e8dcc0';
    ctx.fillRect(ax - 4, ay, 9, 1);
    ctx.fillStyle = '#ffd166';
    ctx.fillRect(ax + dir * 4 - (dir > 0 ? 0 : 1), ay - 1, 2, 3);
    ctx.fillStyle = '#d2483f';
    ctx.fillRect(ax - dir * 4, ay - 1, 2, 3);
  }

  // —— 地面预警圈（Boss 起手）：椭圆贴合 2.5D 地面，随时间收缩 ——
  for (const t of fx.telegraphs) {
    const k = Math.min(1, t.age / t.life);
    const r = t.r0 + (t.r1 - t.r0) * k;
    const cx = Math.round(t.x - cam);
    const cy = Math.round(GROUND_TOP + t.y);
    const ry = Math.max(3, r * 0.38);   // 纵深压扁，读起来像贴在地上
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(cx, cy, r, ry, 0, 0, Math.PI * 2);
    ctx.closePath();
    // 前摇末段闪两下，提示"马上要炸"
    const blink = k > 0.75 ? (Math.floor(t.age / 3) % 2 ? 0.9 : 0.35) : 0.55;
    ctx.globalAlpha = blink * (0.35 + 0.45 * k);
    ctx.strokeStyle = t.color;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.globalAlpha = blink * (0.10 + 0.18 * k);
    ctx.fillStyle = t.color;
    ctx.fill();
    ctx.restore();
  }
  ctx.globalAlpha = 1;

  // —— 打击特效：火花 + 伤害数字 ——
  for (const pt of fx.particles) {
    const a = 1 - pt.age / pt.life;
    ctx.globalAlpha = Math.max(0, Math.min(1, a * 1.4));
    ctx.fillStyle = pt.color;
    ctx.fillRect(Math.round(pt.x - cam), Math.round(GROUND_TOP + pt.y - pt.z), pt.size, pt.size);
  }
  ctx.globalAlpha = 1;
  for (const n of fx.numbers) {
    const a = 1 - n.age / n.life;
    ctx.globalAlpha = Math.max(0, Math.min(1, a * 1.6));
    const w = textWidth(n.text, n.scale);
    drawText(ctx, n.text, Math.round(n.x - cam - w / 2), Math.round(GROUND_TOP + n.y - 22 - n.z),
      n.color, n.scale, n.outline);
  }
  ctx.globalAlpha = 1;

  // 命中闪白
  if (state.flash > 0) {
    ctx.fillStyle = `rgba(255,255,255,${state.flash * 0.55})`;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    state.flash = Math.max(0, state.flash - 0.06);
  }
  state.shake = Math.max(0, state.shake - 0.5);

  // —— 蓄力提示：按住攻击键时在角色脚下涨出一圈光，满蓄转金 ——
  if (charge.startFrame >= 0 && state.mode === 'play' && !state.paused) {
    const held = state.frame - charge.startFrame;
    const k = Math.min(1, held / CHARGE.frames);
    const ready = held >= CHARGE.frames;
    // 精灵的水平锚点比脚部中心偏右 4.5px（剑把 bbox 拉宽了），
    // 所以脚在屏幕上是 sx - 4.5；镜像后变成 sx + 4.5。
    const FOOT_OFFSET = 4.5;
    const footX = Math.round(world.player.x - cam - world.player.facing * FOOT_OFFSET);
    const py = Math.round(GROUND_TOP + world.player.y);
    const r = 10 + 14 * k;
    // 缩放中心放在**朝向那侧的边缘**：圆心随半径朝面向方向偏移，
    // 另一侧边缘固定不动 —— 朝右时从左边张开，朝左时从右边张开。
    const grow = r - 10;
    const cx = footX + world.player.facing * grow;
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(cx, py, r, r * 0.36, 0, 0, Math.PI * 2);
    // 满蓄后闪烁，提示"可以松手了"
    const blink = ready ? (Math.floor(state.frame / 4) % 2 ? 0.95 : 0.45) : 0.5 + 0.35 * k;
    ctx.globalAlpha = blink;
    ctx.strokeStyle = ready ? '#ffd166' : '#9fc8ff';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  // —— HUD（点阵字，杜绝抗锯齿糊边）——
  const p = world.player;
  ctx.fillStyle = 'rgba(8,10,16,.72)';
  ctx.fillRect(6, 6, 202, 34);
  ctx.fillStyle = 'rgba(120,160,200,.14)';
  ctx.fillRect(6, 6, 202, 1);
  ctx.fillStyle = '#0a0d12';
  ctx.fillRect(10, 12, 110, 8);
  ctx.fillStyle = '#59c26a';
  ctx.fillRect(11, 13, Math.round(108 * Math.max(0, p.hp) / p.maxHp), 6);
  ctx.fillStyle = '#0a0d12';
  ctx.fillRect(10, 24, 110, 6);
  ctx.fillStyle = p.meter >= 100 ? '#ffd166' : '#4b8ad6';
  ctx.fillRect(11, 25, Math.round(108 * p.meter / 100), 4);
  drawText(ctx, `HP ${Math.max(0, Math.round(p.hp))}`, 126, 11, '#d8e6d9', 1, '#05070b');
  drawText(ctx, `MP ${Math.round(p.meter)}`, 126, 21, p.meter >= 100 ? '#ffd166' : '#a9c8ff', 1, '#05070b');
  // 飞刀弹药：0 时变暗，提示"没得扔了"
  const ammo = p.ammo ?? 0;
  drawText(ctx, `KNIFE ${ammo}`, 176, 21, ammo > 0 ? '#cfe3ff' : '#5a6a80', 1, '#05070b');
  drawText(ctx, `STAGE ${level.def.id ?? 1}/${STAGES.length}`, 300, 12, '#9fb4d0', 1, '#05070b');
  drawText(ctx, `WAVE ${Math.min(level.segmentIndex + 1, level.def.segments.length)}/${level.def.segments.length}`,
    372, 12, '#9fb4d0', 1, '#05070b');

  if (hitCombo >= 1) {
    const comboLabel = `COMBO x${hitCombo + 1}`;
    const pulse = hitCombo >= 3 ? 1 : 0.8;
    drawText(ctx, comboLabel, 352, 24, `rgba(255,209,102,${pulse})`, 1, '#05070b');
    // 连击评级：连段越长等级越高，给玩家"这一串打得漂亮"的即时反馈
    const grade = comboGrade(hitCombo + 1);
    if (grade) {
      drawText(ctx, grade.label, 408, 24, grade.color, 1, '#05070b');
    }
  }

  if (state.stageBanner && state.stageBanner.frames > 0) {
    ctx.globalAlpha = Math.min(1, state.stageBanner.frames / 40);
    const w = textWidth(state.stageBanner.text, 2);
    drawText(ctx, state.stageBanner.text, (VIEW_W - w) / 2, 66, '#ffd166', 2, '#05070b');
    ctx.globalAlpha = 1;
  }

  // 底部操作提示
  const hint = 'J ATTACK   K ROLL   L SPECIAL   U KNIFE   SPACE JUMP';
  ctx.fillStyle = 'rgba(8,10,16,.55)';
  ctx.fillRect(VIEW_W / 2 - textWidth(hint, 1) / 2 - 4, VIEW_H - 14, textWidth(hint, 1) + 8, 11);
  drawText(ctx, hint, VIEW_W / 2 - textWidth(hint, 1) / 2, VIEW_H - 11, '#8fa6c2', 1);

  if (level.bossSpawned && level.bossActor && !level.bossActor.dead) {
    const bw = 320;
    const by = VIEW_H - 34;
    ctx.fillStyle = 'rgba(8,10,16,.85)';
    ctx.fillRect((VIEW_W - bw) / 2 - 2, by - 2, bw + 4, 13);
    ctx.fillStyle = '#2a1418';
    ctx.fillRect((VIEW_W - bw) / 2, by, bw, 9);
    const boss = level.bossActor;
    // 血条颜色随阶段变化：一阶段赤红 → 二阶段橙 → 三阶段紫，让"它变强了"有颜色记忆
    const PHASE_COLORS = ['#d2483f', '#ff8a3c', '#c74bff', '#ff3ba8'];
    ctx.fillStyle = PHASE_COLORS[Math.min(PHASE_COLORS.length - 1, Math.max(0, (boss.phase || 1) - 1))];
    ctx.fillRect((VIEW_W - bw) / 2 + 1, by + 1, Math.round((bw - 2) * boss.hp / boss.maxHp), 7);
    // 阶段刻度：在每个 phases.at 位置画一道竖线，玩家能预判还差多少血进下一阶段
    if (boss.phases && boss.phases.length) {
      for (const ph of boss.phases) {
        const tx = Math.round((VIEW_W - bw) / 2 + bw * ph.at);
        ctx.fillStyle = 'rgba(255,209,102,.85)';
        ctx.fillRect(tx, by, 1, 9);
      }
    }
    const phaseLabel = boss.phases && boss.phases.length ? `BOSS  P${Math.max(1, boss.phase || 1)}` : 'BOSS';
    drawText(ctx, phaseLabel, (VIEW_W - bw) / 2, by - 12, '#ff8b8b', 1, '#05070b');
  }

  // 清波提示
  if (state.waveToast && performance.now() < state.waveToast.until) {
    const label = `WAVE CLEAR  ${state.waveToast.wave}/${state.waveToast.total}`;
    const tw = textWidth(label, 1);
    ctx.fillStyle = 'rgba(6,10,14,.7)';
    ctx.fillRect((VIEW_W - tw) / 2 - 6, 92, tw + 12, 16);
    drawText(ctx, label, (VIEW_W - tw) / 2, 96, '#9fe0ff', 1, '#05070b');
  }

  // 新手提示：开局 8 秒内逐条淡出，教三个"不看说明就不知道"的技巧
  if (state.tipFrames > 0) {
    const TIPS = [
      'HOLD J  ->  CHARGED SLASH  (breaks shields)',
      'K  ->  ROLL THROUGH ENEMIES',
      'SPACE  ->  JUMP  (hit flyers in the air)',
    ];
    // 每条显示 2.6 秒
    const idx = Math.min(2, Math.floor((480 - state.tipFrames) / 160));
    const tip = TIPS[idx];
    const tw = textWidth(tip, 1);
    const alpha = Math.min(1, state.tipFrames / 60);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = 'rgba(6,10,14,.72)';
    ctx.fillRect((VIEW_W - tw) / 2 - 8, 108, tw + 16, 16);
    drawText(ctx, tip, (VIEW_W - tw) / 2, 112, '#9fe0ff', 1, '#05070b');
    ctx.globalAlpha = 1;
  }

  // 阶段切换提示：屏幕中央偏上，1.2 秒后自动消失
  if (state.bossPhaseToast && performance.now() < state.bossPhaseToast.until) {
    const label = `PHASE ${state.bossPhaseToast.phase}`;
    const tw = textWidth(label, 2);
    ctx.fillStyle = 'rgba(6,10,14,.72)';
    ctx.fillRect((VIEW_W - tw) / 2 - 8, 64, tw + 16, 22);
    drawText(ctx, label, (VIEW_W - tw) / 2, 70, '#ffd166', 2, '#05070b');
  }

  if (state.stageClear) {
    ctx.fillStyle = 'rgba(6,10,14,.87)';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    const title = state.stageClear.text;
    drawText(ctx, title, (VIEW_W - textWidth(title, 3)) / 2, VIEW_H / 2 - 26, '#ffd166', 3, '#05070b');
    const timeLine = `TIME ${formatTime(state.stageClear.timeMs)}`;
    drawText(ctx, timeLine, (VIEW_W - textWidth(timeLine, 1)) / 2, VIEW_H / 2 + 12, '#e8dcc0', 1, '#05070b');
    const next = STAGES[state.stageIndex + 1];
    if (next) {
      const nextLine = `NEXT  STAGE ${next.id}  ${next.name}`;
      drawText(ctx, nextLine, (VIEW_W - textWidth(nextLine, 1)) / 2, VIEW_H / 2 + 30, '#9fb4d0', 1, '#05070b');
    }
  }
  if (state.paused) {
    ctx.fillStyle = 'rgba(5,7,12,.74)';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    const ptitle = 'PAUSED';
    drawText(ctx, ptitle, (VIEW_W - textWidth(ptitle, 3)) / 2, VIEW_H / 2 - 34, '#e8dcc0', 3, '#05070b');
    const phint = 'ESC RESUME   R RESTART   M MUTE';
    drawText(ctx, phint, (VIEW_W - textWidth(phint, 1)) / 2, VIEW_H / 2 + 4, '#9fb4d0', 1, '#05070b');
  }

  if ((state.won || state.lost) && !state.stageClear) {
    ctx.fillStyle = state.won ? 'rgba(8,26,18,.93)' : 'rgba(28,6,8,.93)';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    // 中央牌匾
    ctx.fillStyle = state.won ? 'rgba(20,44,30,.9)' : 'rgba(50,14,16,.9)';
    ctx.fillRect(40, VIEW_H / 2 - 46, VIEW_W - 80, 112);
    ctx.fillStyle = state.won ? '#3f7a55' : '#7a3f45';
    ctx.fillRect(40, VIEW_H / 2 - 46, VIEW_W - 80, 1);
    ctx.fillRect(40, VIEW_H / 2 + 65, VIEW_W - 80, 1);
    const title = state.won ? (STAGES.length > 1 ? 'ALL STAGES CLEAR' : 'STAGE CLEAR') : 'YOU DIED';
    const scale = 3;
    drawText(ctx, title, (VIEW_W - textWidth(title, scale)) / 2, VIEW_H / 2 - 26,
      state.won ? '#ffd166' : '#ff8b8b', scale, '#05070b');
    if (state.won) {
      const r = state.result;
      if (r) {
        const timeLine = `TIME ${formatTime(r.timeMs)}`;
        drawText(ctx, timeLine, (VIEW_W - textWidth(timeLine, 1)) / 2, VIEW_H / 2 + 4, '#e8dcc0', 1, '#05070b');
        const rankLine = `RANK ${r.grade}`;
        drawText(ctx, rankLine, (VIEW_W - textWidth(rankLine, 1)) / 2, VIEW_H / 2 + 16, '#ffd166', 1, '#05070b');
        const bestLine = r.isNewBest
          ? 'NEW BEST!'
          : (state.records.bestTimeMs !== null ? `BEST ${formatTime(state.records.bestTimeMs)}` : '');
        if (bestLine) {
          drawText(ctx, bestLine, (VIEW_W - textWidth(bestLine, 1)) / 2, VIEW_H / 2 + 30,
            r.isNewBest ? '#7dffb0' : '#9fb4d0', 1, '#05070b');
        }
      }
      const comboLine = `MAX COMBO x${Math.max(1, state.maxCombo)}`;
      drawText(ctx, comboLine, (VIEW_W - textWidth(comboLine, 1)) / 2, VIEW_H / 2 + 44, '#9fe0b0', 1, '#05070b');
      const again = 'PRESS R TO PLAY AGAIN';
      drawText(ctx, again, (VIEW_W - textWidth(again, 1)) / 2, VIEW_H / 2 + 57, '#9fb4d0', 1, '#05070b');
    } else {
      const sub = 'PRESS R TO RESTART';
      drawText(ctx, sub, (VIEW_W - textWidth(sub, 1)) / 2, VIEW_H / 2 + 24, '#cfd8e6', 1, '#05070b');
    }
  }
}

function frame(now) {
  const dt = Math.min(250, now - last);
  last = now;
  acc += dt;
  const tl0 = performance.now();
  let guard = 0;
  while (acc >= STEP_MS && guard++ < 5) {
    acc -= STEP_MS;
    if (state.mode === 'play' && !state.paused) {
      // 关间停顿：冻结战斗，只等墙钟 2 秒后进下一关
      if (state.stageClear) {
        state.frame++;
        if (performance.now() >= state.stageClear.endsAt) advanceStage();
      } else {
        logicStep();
      }
    } else state.frame++;
  }
  const tl1 = performance.now();
  draw();
  const tl2 = performance.now();

  const pf = state.perf || (state.perf = { logic: 0, draw: 0, frames: 0, logicMax: 0, drawMax: 0 });
  pf.logic += tl1 - tl0;
  pf.draw += tl2 - tl1;
  pf.logicMax = Math.max(pf.logicMax, tl1 - tl0);
  pf.drawMax = Math.max(pf.drawMax, tl2 - tl1);
  pf.frames++;
  if (pf.frames > 100000) { pf.logic = pf.draw = pf.logicMax = pf.drawMax = 0; pf.frames = 0; }

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

addEventListener('keydown', (e) => {
  if (e.code === 'KeyR' && (state.won || state.lost || state.paused)) location.reload();
});

globalThis.__game = state;
state.press = (a) => world.press(a);
state.setDir = (x, y) => { world.dir = { x, y }; };
state.audioNow = audioSnapshot;
// 取证用：蓄力状态（按住起始帧 / 已按帧数）
state.charge = charge;
state.chargeHeld = () => (charge.startFrame < 0 ? -1 : state.frame - charge.startFrame);
state.ready = true;


