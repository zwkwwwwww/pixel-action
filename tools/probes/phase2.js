// Phase 2 取证：精灵动画是否真的按状态切换（idle → walk → attack → hurt）。
(async () => {
  const g = globalThis.__game;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const down = (code) => dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true }));
  const up = (code) => dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true }));
  // 标题画面：先 Enter 进游戏
  dispatchEvent(new KeyboardEvent('keydown', { code: 'Enter', bubbles: true }));
  dispatchEvent(new KeyboardEvent('keyup', { code: 'Enter', bubbles: true }));
  await new Promise((r) => setTimeout(r, 120));

  const idleShot = { state: g.world.player.state, x: Math.round(g.world.player.x) };
  await wait(200);

  down('ArrowRight');
  await wait(700);
  const walking = { x: Math.round(g.world.player.x), state: g.world.player.state };
  up('ArrowRight');
  await wait(120);

  // 攻击：等到 active 帧附近再返回，截图落在挥砍中
  down('KeyJ');
  await wait(90);
  up('KeyJ');
  await wait(60);

  return {
    art: g.art,
    idleShot,
    walking,
    playerState: g.world.player.state,
    playerAttack: g.world.player.attack,
    stateFrame: g.world.player.stateFrame,
    enemyCount: g.world.enemies.length,
    spriteDrawn: g.art.drawnSprites,
    viewportScale: g.viewport.scale,
  };
})();
