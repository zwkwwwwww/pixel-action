// 输入映射：把「按键状态」翻译成方向向量。纯函数，可在 node 单测。
// 2.5D 清版动作的走位语义：X 是画面左右，Y 是纵深车道（上下）。

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
