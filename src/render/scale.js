// 视口缩放：游戏内部永远只用 480×270 像素绘制，显示层做「整数倍」最近邻放大。
// 为什么必须是整数：非整数缩放会把 1px 描边拉成 2~3px 的糊边，像素画立刻失去味道。
// 这个模块是纯函数，不碰 DOM，方便在 node 里单测。

export const BASE_W = 480;
export const BASE_H = 270;

/**
 * @param {number} winW 浏览器可视宽（CSS px）
 * @param {number} winH 浏览器可视高（CSS px）
 * @returns {{scale:number, cssW:number, cssH:number, offsetX:number, offsetY:number}}
 */
export function computeViewport(winW, winH, baseW = BASE_W, baseH = BASE_H) {
  const w = Number.isFinite(winW) && winW > 0 ? winW : baseW;
  const h = Number.isFinite(winH) && winH > 0 ? winH : baseH;

  let scale = Math.floor(Math.min(w / baseW, h / baseH));
  if (!Number.isFinite(scale) || scale < 1) scale = 1;

  const cssW = baseW * scale;
  const cssH = baseH * scale;
  return {
    scale,
    cssW,
    cssH,
    offsetX: Math.floor((w - cssW) / 2),
    offsetY: Math.floor((h - cssH) / 2),
  };
}
