// 连打节奏：把"第几下命中该用什么音"从主循环里拆出来，纯函数、可单测。
//
// 设计意图：连打时不能每下都用同一个采样（耳朵会迅速适应，听成机关枪）。
// - 同一连段内音高按三级循环上升（0.96 / 0.995 / 1.03），制造"越来越急"的推进感；
// - 每第 4 下给一记重音（音更低更厚），形成 3 轻 1 重的律动；
// - 超过 700ms 没命中就视为连段结束，音高归零。

export const COMBO_WINDOW_MS = 700;

/** 根据当前连段计数算出这一击的重音标记与播放速率。 */
export function hitVariation(combo) {
  const heavy = combo % 4 === 3;
  const rate = (heavy ? 0.93 : 0.96) + (combo % 3) * 0.035;
  return { heavy, rate };
}

/** 推进连段计数：在窗口内 +1，否则从 0 重新开始。 */
export function nextCombo(prevCombo, nowMs, lastHitMs, windowMs = COMBO_WINDOW_MS) {
  return nowMs - lastHitMs < windowMs ? prevCombo + 1 : 0;
}
