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

function applyViewport() {  const v = computeViewport(innerWidth, innerHeight);
  state.viewport = v;
  canvas.style.width = `${v.cssW}px`;
  canvas.style.height = `${v.cssH}px`;
}
addEventListener('resize', applyViewport);
applyViewport();

addEventListener('keydown', (e) => {
  const k = KEYMAP[e.code];
  if (k) { keys[k] = true; e.preventDefault(); return; }
  const action = ACTION_KEYS[e.code];
  if (action) {
    if (world.player.dead || level.won) return;
    world.press(action);
    e.preventDefault();
  }
});
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
    }
    state.lastEvents.push(ev);
  }
  updateEffects(fx);
  while (state.lastEvents.length > 40) state.lastEvents.shift();

  // 相机：跟随玩家并夹在闸门内
  const limit = cameraLimit(level);
  const target = Math.max(0, Math.min(limit - VIEW_W, world.player.x - VIEW_W * 0.45));
  state.camX = Math.max(0, target);
}

function drawBlock(x, y, w, h, color, outline = '#0a0d12') {
  ctx.fillStyle = outline;
  ctx.fillRect(Math.round(x) - 1, Math.round(y) - 1, w + 2, h + 2);
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), w, h);
  state.drawnActors++;
}

const ENEMY_COLORS = { grunt: '#5ec27a', brute: '#d08a3e', ranger: '#9b7bd8', boss: '#d2483f' };

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

function draw() {
  const cam = state.camX;
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

  // 闸门（视觉上明确「这里过不去」）
  if (level.gateX != null) {
    const gx = Math.round(level.gateX - cam);
    if (gx > -10 && gx < VIEW_W + 10) {
      ctx.fillStyle = 'rgba(210,72,63,.22)';
      ctx.fillRect(gx, GROUND_TOP - 90, 10, VIEW_H - GROUND_TOP + 90);
      ctx.fillStyle = '#d2483f';
      ctx.fillRect(gx + 3, GROUND_TOP - 90, 4, VIEW_H - GROUND_TOP + 90);
    }
  }

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
        // 尸体：压扁变暗，明确「已阵亡」，不再像站着
        ctx.fillStyle = '#0a0d12';
        ctx.fillRect(Math.round(sx - size / 2) - 1, Math.round(sy - 7), size + 2, 8);
        ctx.fillStyle = '#2b323d';
        ctx.fillRect(Math.round(sx - size / 2), Math.round(sy - 6), size, 6);
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

    // 血条（玩家不画，HUD 已经有了；画在头顶只会挡脸）
    if (!a.dead && kind !== 'player') {
      const w = a.kind === 'boss' ? 52 : 22;
      const bx = Math.round(sx - w / 2);
      const by = Math.round(sy - (kind === 'player' ? HERO_H : (a.kind === 'boss' ? 44 : 28)) - airborne - (kind === 'player' ? 10 : 8));
      ctx.fillStyle = '#0a0d12';
      ctx.fillRect(bx - 1, by - 1, w + 2, 4);
      ctx.fillStyle = kind === 'player' ? '#59c26a' : '#d2483f';
      ctx.fillRect(bx, by, Math.round((w * a.hp) / a.maxHp), 2);
    }
  }
  ctx.restore();

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
    ctx.fillStyle = 'rgba(8,10,16,.8)';
    ctx.fillRect((VIEW_W - bw) / 2, VIEW_H - 18, bw, 11);
    ctx.fillStyle = '#d2483f';
    ctx.fillRect((VIEW_W - bw) / 2 + 1, VIEW_H - 17, Math.round((bw - 2) * level.bossActor.hp / level.bossActor.maxHp), 9);
  }

  if (state.won || state.lost) {
    ctx.fillStyle = state.won ? 'rgba(14,40,26,.86)' : 'rgba(40,10,12,.86)';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    const title = state.won ? 'STAGE CLEAR' : 'YOU DIED';
    const scale = 3;
    drawText(ctx, title, (VIEW_W - textWidth(title, scale)) / 2, VIEW_H / 2 - 24,
      state.won ? '#ffd166' : '#ff8b8b', scale, '#05070b');
    const sub = 'PRESS R TO RESTART';
    drawText(ctx, sub, (VIEW_W - textWidth(sub, 1)) / 2, VIEW_H / 2 + 18, '#cfd8e6', 1, '#05070b');
  }
}

function frame(now) {
  const dt = Math.min(250, now - last);
  last = now;
  acc += dt;
  let guard = 0;
  while (acc >= STEP_MS && guard++ < 5) {
    acc -= STEP_MS;
    logicStep();
  }
  draw();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

addEventListener('keydown', (e) => {
  if (e.code === 'KeyR' && (state.won || state.lost)) location.reload();
});

globalThis.__game = state;
state.press = (a) => world.press(a);
state.setDir = (x, y) => { world.dir = { x, y }; };
state.ready = true;
