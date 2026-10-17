// 《锈月回响》入口：Phase 1 —— 色块版可玩（真实美术在 Phase 2/3 接入）。
// 逻辑固定 60fps 步进；渲染只读世界状态。
import { computeViewport } from './render/scale.js';
import { dirFromKeys } from './core/input.js';
import { createWorld, step } from './core/world.js';
import { WORLD } from './core/actor.js';
import { createLevel, updateLevel, cameraLimit } from './core/level.js';
import { enemyThink } from './core/ai.js';
import { ATTACKS } from './core/attacks.js';

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

const state = {
  ready: false,
  world,
  level,
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
};

function applyViewport() {
  const v = computeViewport(innerWidth, innerHeight);
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
    }
    state.lastEvents.push(ev);
  }
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

function draw() {
  const cam = state.camX;
  const shakeX = (Math.random() - 0.5) * state.shake;
  const shakeY = (Math.random() - 0.5) * state.shake;

  // 背景
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

  // 远景废墟剪影（视差 0.35）
  ctx.fillStyle = '#161c28';
  for (let i = 0; i < 16; i++) {
    const wx = i * 140 + 30;
    const bx = wx - cam * 0.35;
    if (bx < -80 || bx > VIEW_W + 80) continue;
    const bh = 38 + ((i * 53) % 60);
    ctx.fillRect(Math.round(bx), GROUND_TOP - bh, 60, bh);
  }

  // 地面与车道
  ctx.fillStyle = '#1d2430';
  ctx.fillRect(0, GROUND_TOP, VIEW_W, VIEW_H - GROUND_TOP);
  for (let i = 0; i <= 4; i++) {
    const y = GROUND_TOP + (WORLD.DEPTH_MAX * i) / 4;
    ctx.fillStyle = i === 0 || i === 4 ? '#334054' : '#252f3d';
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

    if (kind === 'player') {
      const h = HERO_H;
      // 影子
      ctx.fillStyle = 'rgba(0,0,0,.35)';
      ctx.fillRect(Math.round(sx - 10), Math.round(sy - 3), 20, 4);
      // 闪避时半透明（无敌帧可视化）
      ctx.globalAlpha = a.invuln > 0 ? 0.55 : 1;
      drawBlock(sx - HERO_W / 2, sy - h - airborne, HERO_W, h, a.state === 'attack' ? '#ff7a5c' : '#e0483c');
      ctx.globalAlpha = 1;
      // 朝向
      ctx.fillStyle = '#ffd166';
      ctx.fillRect(Math.round(a.facing > 0 ? sx + HERO_W / 2 - 2 : sx - HERO_W / 2 - 2), Math.round(sy - h + 5), 4, 8);
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
        drawBlock(
          sx - size / 2, sy - size - airborne, size, size,
          a.state === 'hurt' ? '#ffffff' : (ENEMY_COLORS[a.kind] || '#888'),
        );
      }
      if (a.state === 'attack') {
        // 起手预警：头顶红色感叹号
        ctx.fillStyle = '#ff5252';
        ctx.fillRect(Math.round(sx) - 1, Math.round(sy - size - airborne - 12), 2, 7);
        ctx.fillRect(Math.round(sx) - 1, Math.round(sy - size - airborne - 3), 2, 2);
      }
    }

    // 血条
    if (!a.dead) {
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

  // 命中闪白
  if (state.flash > 0) {
    ctx.fillStyle = `rgba(255,255,255,${state.flash * 0.55})`;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    state.flash = Math.max(0, state.flash - 0.06);
  }
  state.shake = Math.max(0, state.shake - 0.5);

  // —— HUD ——
  const p = world.player;
  ctx.fillStyle = 'rgba(8,10,16,.74)';
  ctx.fillRect(6, 6, 190, 30);
  ctx.fillStyle = '#0a0d12';
  ctx.fillRect(10, 12, 110, 8);
  ctx.fillStyle = '#59c26a';
  ctx.fillRect(11, 13, Math.round(108 * Math.max(0, p.hp) / p.maxHp), 6);
  ctx.fillStyle = '#0a0d12';
  ctx.fillRect(10, 24, 110, 5);
  ctx.fillStyle = p.meter >= 100 ? '#ffd166' : '#4b8ad6';
  ctx.fillRect(11, 25, Math.round(108 * p.meter / 100), 3);
  ctx.fillStyle = '#9fb4d0';
  ctx.font = '9px monospace';
  ctx.textBaseline = 'top';
  ctx.fillText(`HP ${Math.max(0, Math.round(p.hp))}  MP ${Math.round(p.meter)}  WAVE ${level.segmentIndex}/3`, 130, 11);
  ctx.fillText('J 攻击  K 闪避  L 必杀', 130, 23);

  if (level.bossSpawned && level.bossActor && !level.bossActor.dead) {
    const bw = 320;
    ctx.fillStyle = 'rgba(8,10,16,.8)';
    ctx.fillRect((VIEW_W - bw) / 2, VIEW_H - 18, bw, 11);
    ctx.fillStyle = '#d2483f';
    ctx.fillRect((VIEW_W - bw) / 2 + 1, VIEW_H - 17, Math.round((bw - 2) * level.bossActor.hp / level.bossActor.maxHp), 9);
  }

  if (state.won || state.lost) {
    ctx.fillStyle = state.won ? 'rgba(20,60,35,.82)' : 'rgba(60,16,16,.82)';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    ctx.fillStyle = state.won ? '#ffd166' : '#ff8888';
    ctx.font = 'bold 24px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(state.won ? '关卡通过' : '你倒下了', VIEW_W / 2, VIEW_H / 2 - 14);
    ctx.font = '10px monospace';
    ctx.fillStyle = '#cfd8e6';
    ctx.fillText('按 R 重新开始', VIEW_W / 2, VIEW_H / 2 + 18);
    ctx.textAlign = 'left';
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
