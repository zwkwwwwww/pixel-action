// 输入映射：把「按键状态」翻译成方向向量；输入缓冲让连招不吃手速。
// 纯函数/纯数据，可在 node 单测（不碰 DOM）。

export const LANE_COUNT = 4;

/**
 * @param {{left?:boolean,right?:boolean,up?:boolean,down?:boolean}|undefined} keys
 * @returns {{x:number,y:number}} 每个分量 ∈ {-1,0,1}
 */
export function dirFromKeys(keys) {
  const k = keys || {};
  const x = (k.right ? 1 : 0) - (k.left ? 1 : 0);
  const y = (k.down ? 1 : 0) - (k.up ? 1 : 0);
  return { x, y };
}

/**
 * 输入缓冲：记录按键发生在哪一帧，允许在「窗口期内」被后续逻辑消费。
 * 为什么需要：动作游戏里玩家会在上一招收招时提前按键，严格即时判定会吞输入，手感立刻变差。
 */
export class InputBuffer {
  constructor(size = 8) {
    this.size = size;
    this.items = [];
  }

  /** 记录一次动作输入。 */
  press(action, frame) {
    this.items.push({ action, frame });
    while (this.items.length > this.size) this.items.shift();
  }

  /**
   * 消费一次窗口期内的输入。
   * @returns {boolean} 是否真的吃到
   */
  consume(action, frame, window = 6) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      if (it.action !== action) continue;
      if (frame - it.frame <= window) {
        this.items.splice(i, 1);
        return true;
      }
    }
    return false;
  }

  /** 清掉超龄输入，避免很久以前按的键在几秒后突然触发。 */
  tick(frame, ttl = 12) {
    this.items = this.items.filter((it) => frame - it.frame <= ttl);
  }

  clear() {
    this.items.length = 0;
  }
}
