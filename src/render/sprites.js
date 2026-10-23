// 精灵表加载与绘制（浏览器层，不参与 node 单测）。
// 元数据格式见 docs/art-contract.md：{ image, cell:[w,h], anchor:[x,y], clips:{name:{fps,loop,frames:[[x,y]...]}} }
import { clipForActor, frameIndexAt, stateSeconds } from '../core/animation.js';

export async function loadSprites(basePath) {
  const res = await fetch(`${basePath}.json`, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`缺少精灵元数据 ${basePath}.json (HTTP ${res.status})`);
  const meta = await res.json();
  // 用清单里的内容哈希做缓存键：素材重建后 URL 变化，浏览器不会继续用旧图
  const version = meta.version ? `?v=${meta.version}` : '';
  const img = new Image();
  img.src = new URL(`${basePath}.png${version}`, location.href).href;
  await img.decode();
  return { meta, img };
}

/** 取某剪辑的帧矩形；剪辑缺失时回退到 attack1/idle/第一个，避免整局消失。 */
export function pickClip(sheet, clip) {
  const { clips } = sheet.meta;
  if (clips[clip]) return { name: clip, ...clips[clip] };
  // 敌人只渲染了 attack1：attack2/3 必须仍能做出「挥砍」动作，不能倒退回待机
  const isAttack = clip.startsWith('attack') || clip === 'special';
  if (isAttack && clips.attack1) return { name: 'attack1', ...clips.attack1 };
  if (clips.idle) return { name: 'idle', ...clips.idle };
  const first = Object.keys(clips)[0];
  return { name: first, ...clips[first] };
}

/**
 * 把角色画到 canvas 上。
 * @param {CanvasRenderingContext2D} ctx
 * @param {{meta:any,img:HTMLImageElement}} sheet
 * @param {object} actor 逻辑角色（读 state/stateFrame/facing/attack）
 * @param {number} screenX 角色地面中心的世界→屏幕 X
 * @param {number} groundY 角色脚下的屏幕 Y
 * @param {number} moving 是否在走
 */
export function drawActorSprite(ctx, sheet, actor, screenX, groundY, moving, scale = 1) {
  if (!sheet) return false;
  const clip = pickClip(sheet, clipForActor(actor, moving));
  const idx = frameIndexAt(clip, stateSeconds(actor));
  const frame = clip.frames[idx] || clip.frames[0];
  const [cw, ch] = sheet.meta.cell;
  const [ax, ay] = sheet.meta.anchor;
  const z = actor.z || 0;

  ctx.save();
  ctx.translate(Math.round(screenX), Math.round(groundY - z * scale));
  if (actor.facing < 0) ctx.scale(-1, 1);
  ctx.scale(scale, scale);
  ctx.drawImage(sheet.img, frame[0], frame[1], cw, ch, -ax, -ay, cw, ch);
  ctx.restore();
  return true;
}

/** 角色当前帧的像素高度（用于血条/影子定位） */
export function spriteHeight(sheet, actor, moving) {
  if (!sheet) return 0;
  return sheet.meta.anchor[1];
}
