// 《锈月回响》入口：Phase 0 只做「480×270 内部分辨率 + 整数倍放大 + 占位方块走位」。
// 美术一律占位符（规则：逻辑未通前不用真实美术）。
import { computeViewport } from './render/scale.js';
import { dirFromKeys } from './core/input.js';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d', { alpha: false });
ctx.imageSmoothingEnabled = false;

// ——— 世界常量（后续 Phase 会挪进 data/）———
const WORLD_W = 3200;          // 关卡总长（世界单位=内部像素）
const WALK_SPEED_X = 108;      // 前进速度 px/s
const WALK_SPEED_Y = 62;       // 纵深走位速度 px/s
const DEPTH_FAR = 150;         // 纵深 0 对应的屏幕 y
const DEPTH_NEAR = 232;        // 纵深最大值对应的屏幕 y
export const DEPTH_MAX = DEPTH_NEAR - DEPTH_FAR;
const HERO_W = 18;
const HERO_H = 40;

const keys = { left: false, right: false, up: false, down: false };
const KEYMAP = {
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
  ArrowUp: 'up', KeyW: 'up',
  ArrowDown: 'down', KeyS: 'down',
};

const state = {
  tick: 0,
  hero: { x: 120, y: DEPTH_MAX * 0.5, facing: 1 },
  camX: 0,
  viewport: computeViewport(innerWidth, innerHeight),
  drawCalls: 0,
  ready: false,
};

// ——— 视口：只改 CSS 尺寸，内部分辨率永远 480×270 ———
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
  if (!k) return;
  keys[k] = true;
  e.preventDefault();
});
addEventListener('keyup', (e) => {
  const k = KEYMAP[e.code];
  if (!k) return;
  keys[k] = false;
  e.preventDefault();
});
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

function update(dt) {
  const dir = dirFromKeys(keys);
  const h = state.hero;
  if (dir.x !== 0) h.facing = dir.x;
  h.x = Math.max(HERO_W, Math.min(WORLD_W - HERO_W, h.x + dir.x * WALK_SPEED_X * dt));
  h.y = Math.max(0, Math.min(DEPTH_MAX, h.y + dir.y * WALK_SPEED_Y * dt));

  // 相机跟人，并夹在关卡两端（镜头不会露关卡外的空白）
  const targetCam = h.x - 480 * 0.42;
  state.camX = Math.max(0, Math.min(WORLD_W - 480, targetCam));
  state.tick++;
}

function draw() {
  state.drawCalls = 0;
  const cam = state.camX;
  const h = state.hero;

  // 天空占位：渐变 + 一轮锈月
  const sky = ctx.createLinearGradient(0, 0, 0, DEPTH_FAR);
  sky.addColorStop(0, '#0b1020');
  sky.addColorStop(0.65, '#232a3d');
  sky.addColorStop(1, '#4a3a35');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, 480, DEPTH_FAR);
  state.drawCalls++;

  ctx.fillStyle = '#c9a227';
  ctx.beginPath();
  ctx.arc(352 - cam * 0.15, 62, 26, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#0b1020';
  ctx.beginPath();
  ctx.arc(340 - cam * 0.15, 54, 24, 0, Math.PI * 2);
  ctx.fill();
  state.drawCalls += 2;

  // 远景剪影（视差 0.35）
  ctx.fillStyle = '#161c28';
  for (let i = 0; i < 14; i++) {
    const bx = i * 90 + 20 - cam * 0.35;
    const bh = 40 + ((i * 37) % 55);
    ctx.fillRect(Math.round(bx % (480 + 120)) - 60, DEPTH_FAR - bh, 46, bh);
    state.drawCalls++;
  }

  // 地面：4 条车道线，越近越疏
  ctx.fillStyle = '#1d2430';
  ctx.fillRect(0, DEPTH_FAR, 480, 270 - DEPTH_FAR);
  state.drawCalls++;
  for (let i = 0; i <= 4; i++) {
    const y = DEPTH_FAR + (DEPTH_MAX * i) / 4;
    ctx.fillStyle = i === 0 || i === 4 ? '#2e3a4d' : '#252f3d';
    ctx.fillRect(0, Math.round(y), 480, 1);
    state.drawCalls++;
  }

  // 占位主角：红方块 + 朝向小三角
  const sx = Math.round(h.x - cam);
  const sy = Math.round(DEPTH_FAR + h.y);
  ctx.fillStyle = '#0a0d12';
  ctx.fillRect(sx - HERO_W / 2 + 2, sy + 1, HERO_W, 4);
  ctx.fillStyle = '#e0483c';
  ctx.fillRect(sx - HERO_W / 2, sy - HERO_H, HERO_W, HERO_H);
  ctx.fillStyle = '#ffd166';
  const t = h.facing > 0 ? sx + HERO_W / 2 - 2 : sx - HERO_W / 2 - 4;
  ctx.fillRect(t, sy - HERO_H + 6, 4, 8);
  state.drawCalls += 4;

  // HUD 占位
  ctx.fillStyle = 'rgba(8,10,16,.72)';
  ctx.fillRect(4, 4, 168, 18);
  ctx.fillStyle = '#9fb4d0';
  ctx.font = '10px monospace';
  ctx.textBaseline = 'top';
  ctx.fillText('PHASE 0 / WASD 走位', 9, 8);
  state.drawCalls += 2;
}

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  update(dt);
  draw();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// 取证接口：探针从这里读状态与位置
globalThis.__game = state;
state.ready = true;
state.api = { keys };
