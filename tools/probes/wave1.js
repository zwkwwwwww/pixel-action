// 第一波实况截图：进游戏 → 走到触发点 → 打两下，保留敌人存活，用于检查 UI 红线是否已移除。
(async () => {
  const g = globalThis.__game;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const down = (code) => dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true }));
  const up = (code) => dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true }));

  down('Enter'); up('Enter');
  await wait(400);

  down('ArrowRight');
  for (let i = 0; i < 60 && g.world.enemies.length === 0; i++) await wait(50);
  up('ArrowRight');
  await wait(500);

  // 打一下制造命中特效，但保留敌人
  for (let i = 0; i < 6; i++) {
    const alive = g.world.enemies.filter((e) => !e.dead);
    if (!alive.length) break;
    const near = alive.reduce((a, b) => (Math.abs(a.x - g.world.player.x) <= Math.abs(b.x - g.world.player.x) ? a : b));
    const dx = near.x - g.world.player.x;
    if (Math.abs(dx) > 24) {
      down(dx > 0 ? 'ArrowRight' : 'ArrowLeft'); await wait(80); up(dx > 0 ? 'ArrowRight' : 'ArrowLeft');
    } else {
      down('KeyJ'); await wait(26); up('KeyJ'); await wait(140);
    }
  }
  await wait(80);
  return {
    enemies: g.world.enemies.map((e) => ({ kind: e.kind, dead: e.dead, hp: e.hp })),
    gateX: g.level.gateX,
    camX: Math.round(g.camX),
  };
})();
