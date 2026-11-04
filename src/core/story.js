// 叙事文案：纯数据，可在 node 单测（不碰 DOM）。
//
// 约束：像素字体只支持 A-Z 0-9 和 . ! ? : - / + ，
// 逗号 / 引号 / 括号 / 分号 是**空白字形**（声明了但没画内容），
// 所以文案里绝不能出现这些字符 —— 单测会强制校验。

/** 每幕：{ bg: 背景图 id, portrait: 立绘 id 或 null, lines: [逐行文字] } */
export const STORY = {
  intro: [
    {
      bg: 'bg_intro_1', portrait: null,
      lines: ['THE MOON RUSTED THREE NIGHTS AGO.', 'WHAT FELL FROM IT STILL BURNS.'],
    },
    {
      bg: 'bg_intro_2', portrait: 'hero_portrait',
      lines: ['A CITY OF ASH - A STREET OF IRON.', 'THE KNIGHTS THAT GUARD IT HAVE FORGOTTEN WHY.'],
    },
    {
      bg: 'bg_intro_3', portrait: 'hero_portrait',
      lines: ['YOU CARRY ONE BLADE.', 'CLIMB THE CLOCK TOWER. END THE ECHO.'],
    },
  ],
  ending: [
    {
      bg: 'bg_ending', portrait: 'hero_portrait',
      lines: ['THE ECHO STOPS.', 'THE MOON IS QUIET. FOR NOW.'],
    },
  ],
};

/** 逐字机速度：每个渲染帧推进多少个字符。 */
export const STORY_CHARS_PER_FRAME = 0.55;

/** 字体里没有实际笔画的字符（写了也看不见）。 */
export const BLANK_GLYPHS = [',', ';', "'", '"', '(', ')', '[', ']', '<', '>', '=', '|', '*', '#'];

/** 某一幕的总字符数（逐字机用）。 */
export function sceneCharCount(scene) {
  return scene.lines.reduce((n, line) => n + line.length, 0);
}
