// Phase 1 端到端取证：真实键盘事件驱动，验证「走路 → 刷怪 → 攻击命中 → 闸门 → 闪避无敌」。
(async () => {
  const g = globalThis.__game;
  if (!g) return { error: '__game 不存在' };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const down = (code) => dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true }));
  const up = (code) => dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true }));
  const snap = () => ({
    frame: g.frame,
    playerX: Number(g.world.player.x.toFixed(1)),
    playerY: Number(g.world.player.y.toFixed(1)),
    hp: g.world.player.hp,
    meter: g.world.player.meter,
    state: g.world.player.state,
    enemies: g.world.enemies.map((e) => ({ kind: e.kind, x: Number(e.x.toFixed(1)), hp: e.hp, dead: e.dead, state: e.state })),
    gateX: g.level.gateX,
    segmentIndex: g.level.segmentIndex,
    won: g.level.won,
    camX: Number(g.camX.toFixed(1)),
  });

  const t0 = snap();

  // 1) 向右走，直到第一波刷出来
  down('ArrowRight');
  for (let i = 0; i < 80 && g.world.enemies.length === 0; i++) await wait(50);
  up('ArrowRight');
  await wait(120);
  const wave = snap();

  // 2) 靠近敌人并攻击，验证命中
  let hits = 0;
  const hpBefore = g.world.enemies.map((e) => e.hp);
  for (let i = 0; i < 90; i++) {
    const alive = g.world.enemies.filter((e) => !e.dead);
    if (alive.length === 0) break;
    const near = alive.reduce((a, b) => (Math.abs(a.x - g.world.player.x) <= Math.abs(b.x - g.world.player.x) ? a : b));
    const dx = near.x - g.world.player.x;
    const dy = near.y - g.world.player.y;
    if (Math.abs(dx) > 20) {
      down(dx > 0 ? 'ArrowRight' : 'ArrowLeft');
      await wait(60);
      up(dx > 0 ? 'ArrowRight' : 'ArrowLeft');
    } else if (Math.abs(dy) > 5) {
      down(dy > 0 ? 'ArrowDown' : 'ArrowUp');
      await wait(50);
      up(dy > 0 ? 'ArrowDown' : 'ArrowUp');
    } else {
      down('KeyJ');
      await wait(30);
      up('KeyJ');
      await wait(150);
    }
    hits = g.lastEvents.filter((e) => e.type === 'hit').length;
  }
  await wait(200);
  const afterCombat = snap();

  // 3) 闪避：按 K，读 invuln
  down('KeyK');
  await wait(30);
  up('KeyK');
  await wait(40);
  const dodgeInvuln = g.world.player.invuln;

  return {
    t0,
    wave,
    waveSpawned: wave.enemies.length > 0,
    gateDropped: wave.gateX != null,
    hpBefore,
    afterCombat,
    damageDealt: hpBefore.reduce((s, hp, i) => s + (hp - (afterCombat.enemies[i]?.hp ?? hp)), 0),
    hits,
    dodgeInvuln,
    dodgeGrantsIframes: dodgeInvuln > 0,
    internal: { w: document.getElementById('game').width, h: document.getElementById('game').height },
    consoleClean: true,
  };
})();
