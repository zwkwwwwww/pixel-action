// 《锈月回响》入口：Phase 1 —— 色块版可玩（真实美术在 Phase 2/3 接入）。
// 逻辑固定 60fps 步进；渲染只读世界状态。
import { computeViewport } from './render/scale.js';
import { dirFromKeys } from './core/input.js';
import { createWorld, step } from './core/world.js';
import { WORLD } from './core/actor.js';
import { createLevel, updateLevel, cameraLimit } from './core/level.js';
import { enemyThink } from './core/ai.js';
import { ATTACKS } from './core/attacks.js';
import { loadSprites, drawActorSprite } from './render/sprites.js';
import { drawText, textWidth } from './render/pixelfont.js';
import { createEffects, spawnHitFx, updateEffects } from './core/effects.js';
import { initAudio, playSfx, playBgm, stopBgm, toggleMute, audioSnapshot } from './render/audio.js';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d', { alpha: false });
ctx.imageSmoothingEnabled = false;

const VIEW_W = 480;
const VIEW_H = 270;
const GROUND_TOP = 150;
const HERO_H = 40;
const HERO_W = 18;

const keys = { left: false, right: false, up: false, down: false };
const KEYMAP = {
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
  ArrowUp: 'up', KeyW: 'up',
  ArrowDown: 'down', KeyS: 'down',
};
const ACTION_KEYS = { KeyJ: 'attack', KeyK: 'dodge', KeyL: 'special', Space: 'attack' };

const world = createWorld({
  player: { x: 120, y: 41, hp: 120, maxHp: 120 },
  enemies: [],
  enemyThink,
});
const level = createLevel();
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
  mode: 'title', // title | play
  art: { loaded: [], missing: [], drawnSprites: 0 },
};

// —— 精灵资产（Phase 2/3 管线产物）：缺失时自动回退色块，不阻塞可玩 ——
const SHEETS = {};
const BACKGROUNDS = {};
const prevPos = new Map();
(async () => {
  const want = ['hero', 'grunt', 'brute', 'ranger', 'boss'];
  await Promise.all(want.map(async (name) => {
    try {
      SHEETS[name] = await loadSprites(`assets/sprites/${name}`);
      state.art.loaded.push(name);
    } catch {
      state.art.missing.push(name);
    }
  }));
  const bgWant = ['bg_level', 'bg_boss', 'bg_title'];
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
const prevAudio = { state: '', attack: null, dead: 0, boss: false, won: false, lost: false };
function audioEvents() {
  const p = world.player;
  if (p.state === 'attack' && (prevAudio.state !== 'attack' || prevAudio.attack !== p.attack)) {
    playSfx(p.attack === 'special' ? 'sfx_special' : 'sfx_swing', { volume: 0.65 });
  }
  if (p.state === 'dodge' && prevAudio.state !== 'dodge') playSfx('sfx_dodge', { volume: 0.55 });

  const dead = world.enemies.filter((e) => e.dead).length;
  if (dead > prevAudio.dead) playSfx('sfx_death', { volume: 0.5 });

  if (level.bossSpawned && !prevAudio.boss) {
    playBgm('bgm_boss', { volume: 0.5 });
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
    if (e.code === 'Enter' || e.code === 'Space' || e.code === 'KeyJ') {
      state.mode = 'play';
      playBgm('bgm_battle', { volume: 0.45 });
      e.preventDefault();
    }
    return;
  }
  const k = KEYMAP[e.code];
  if (k) { keys[k] = true; e.preventDefault(); return; }
  if (e.code === 'KeyM') { toggleMute(); state.audio = audioSnapshot(); return; }
  const action = ACTION_KEYS[e.code];
  if (action) {
    if (world.player.dead || level.won) return;
    world.press(action);
    e.preventDefault();
  }
});

// 音频必须等一次用户手势才能启动（浏览器自动播放策略）
let audioReady = false;
function ensureAudio() {
  if (audioReady) return;
  audioReady = true;
  initAudio().then(() => {
    state.audio = audioSnapshot();
    // 解码完成时如果已经在游戏里，补上 BGM（Enter 时音频往往还没加载完）
    if (state.mode === 'play') playBgm(level.bossSpawned ? 'bgm_boss' : 'bgm_battle', { volume: 0.45 });
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

function logicStep() {
  world.dir = dirFromKeys(keys);
  step(world);
  updateLevel(world, level);
  state.frame++;
  state.won = level.won;
  state.lost = world.player.dead;

  const evs = world.consumeEvents();
  for (const ev of evs) {
    if (ev.type === 'hit') {
      state.shake = Math.min(6, state.shake + 3);
      state.flash = Math.max(state.flash, ev.killed ? 0.5 : 0.25);
      spawnHitFx(fx, ev);
      playSfx('sfx_hit', { volume: ev.killed ? 0.8 : 0.55 });
    } else if (ev.type === 'shoot') {
      playSfx('sfx_bow', { volume: 0.55 });
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
const SPRITE_H = { hero: 56, grunt: 46, brute: 52, ranger: 48, boss: 112 };
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

  const keys = 'WASD MOVE   J ATTACK   K DODGE   L SPECIAL   M MUTE';
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

  const bg = BACKGROUNDS[level.bossSpawned ? 'bg_boss' : 'bg_level'];
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
        // 先播死亡动画，播完再压成尸体条，避免「一死就瞬间变灰条」
        const drewDeath = a.stateFrame < 60 && drawActorSprite(ctx, SHEETS[a.kind], a, sx, sy, false);
        if (drewDeath) {
          state.art.drawnSprites++;
        } else {
          ctx.fillStyle = '#0a0d12';
          ctx.fillRect(Math.round(sx - size / 2) - 1, Math.round(sy - 7), size + 2, 8);
          ctx.fillStyle = '#2b323d';
          ctx.fillRect(Math.round(sx - size / 2), Math.round(sy - 6), size, 6);
        }
      } else {
        const drew = drawActorSprite(ctx, SHEETS[a.kind], a, sx, sy, moving);
        if (drew) state.art.drawnSprites++;
        if (!drew) {
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
      const topH = SPRITE_H[a.kind] || (a.kind === 'boss' ? 112 : 48);
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
    const ay = Math.round(GROUND_TOP + pr.y - 16);
    if (ax < -16 || ax > VIEW_W + 16) continue;
    const dir = pr.vx >= 0 ? 1 : -1;
    ctx.fillStyle = '#0a0d12';
    ctx.fillRect(ax - 5, ay - 1, 11, 3);
    ctx.fillStyle = '#e8dcc0';
    ctx.fillRect(ax - 4, ay, 9, 1);
    ctx.fillStyle = '#ffd166';
    ctx.fillRect(ax + dir * 4 - (dir > 0 ? 0 : 1), ay - 1, 2, 3);
    ctx.fillStyle = '#d2483f';
    ctx.fillRect(ax - dir * 4, ay - 1, 2, 3);
  }

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
  drawText(ctx, `WAVE ${Math.min(level.segmentIndex + 1, 3)}/3`, 352, 12, '#9fb4d0', 1, '#05070b');

  // 底部操作提示
  const hint = 'J ATTACK   K DODGE   L SPECIAL';
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
    ctx.fillStyle = '#d2483f';
    ctx.fillRect((VIEW_W - bw) / 2 + 1, by + 1, Math.round((bw - 2) * level.bossActor.hp / level.bossActor.maxHp), 7);
    drawText(ctx, 'BOSS', (VIEW_W - bw) / 2, by - 12, '#ff8b8b', 1, '#05070b');
  }

  if (state.won || state.lost) {
    ctx.fillStyle = state.won ? 'rgba(8,26,18,.93)' : 'rgba(28,6,8,.93)';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    // 中央牌匾
    ctx.fillStyle = state.won ? 'rgba(20,44,30,.9)' : 'rgba(50,14,16,.9)';
    ctx.fillRect(40, VIEW_H / 2 - 46, VIEW_W - 80, 96);
    ctx.fillStyle = state.won ? '#3f7a55' : '#7a3f45';
    ctx.fillRect(40, VIEW_H / 2 - 46, VIEW_W - 80, 1);
    ctx.fillRect(40, VIEW_H / 2 + 49, VIEW_W - 80, 1);
    const title = state.won ? 'STAGE CLEAR' : 'YOU DIED';
    const scale = 3;
    drawText(ctx, title, (VIEW_W - textWidth(title, scale)) / 2, VIEW_H / 2 - 26,
      state.won ? '#ffd166' : '#ff8b8b', scale, '#05070b');
    const sub = state.won ? 'THE RUSTED MOON FALLS SILENT' : 'PRESS R TO RESTART';
    drawText(ctx, sub, (VIEW_W - textWidth(sub, 1)) / 2, VIEW_H / 2 + 24, '#cfd8e6', 1, '#05070b');
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
    if (state.mode === 'play') logicStep();
    else state.frame++;
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
  if (e.code === 'KeyR' && (state.won || state.lost)) location.reload();
});

globalThis.__game = state;
state.press = (a) => world.press(a);
state.setDir = (x, y) => { world.dir = { x, y }; };
state.audioNow = audioSnapshot;
state.ready = true;
