// Phase 0 取证：内部分辨率、整数倍缩放、按键真的让占位主角移动。
// 由 tools/browser-probe.mjs 通过 Runtime.evaluate 执行，返回可 JSON 化的对象。
(async () => {
  const g = globalThis.__game;
  if (!g) return { error: '__game 不存在' };

  const canvas = document.getElementById('game');
  const before = { x: g.hero.x, y: g.hero.y };
  const tickBefore = g.tick;

  const press = (code) => addEventListener && dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true }));
  const release = (code) => dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true }));

  press('ArrowRight');
  press('ArrowDown');
  await new Promise((r) => setTimeout(r, 420));
  release('ArrowRight');
  release('ArrowDown');
  await new Promise((r) => setTimeout(r, 80));

  const after = { x: g.hero.x, y: g.hero.y };
  const tickAfter = g.tick;
  const v = g.viewport;

  return {
    ready: g.ready,
    internal: { w: canvas.width, h: canvas.height },
    css: { w: canvas.style.width, h: canvas.style.height },
    viewport: v,
    scaleIsInteger: Number.isInteger(v.scale),
    pixelated: getComputedStyle(canvas).imageRendering,
    tickAdvanced: tickAfter - tickBefore,
    before,
    after,
    movedRight: after.x > before.x + 20,
    movedDown: after.y > before.y + 8,
    drawCalls: g.drawCalls,
    bodyOverflow: document.body.scrollWidth > innerWidth || document.body.scrollHeight > innerHeight,
  };
})();
