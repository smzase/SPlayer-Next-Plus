/**
 * 将选中项按原先相对顺序插入原列表的指定间隙
 * @param items - 原列表
 * @param indices - 需要移动的原始索引
 * @param gapIndex - 原列表中的插入间隙，列表长度表示末尾
 * @returns 重排后的新列表
 */
export const moveItemsToGap = <T>(
  items: readonly T[],
  indices: readonly number[],
  gapIndex: number,
): T[] => {
  const selected = new Set(indices);
  const moved: T[] = [];
  const remaining: T[] = [];
  let insertAt = 0;
  items.forEach((item, index) => {
    if (selected.has(index)) moved.push(item);
    else {
      remaining.push(item);
      if (index < gapIndex) insertAt++;
    }
  });
  remaining.splice(insertAt, 0, ...moved);
  return remaining;
};

/**
 * 将可见歌曲的新顺序写回完整列表，保留暂缺详情的歌曲位置
 * @param ids - 完整歌曲 ID 顺序
 * @param visibleIds - 排序前的可见歌曲 ID
 * @param orderedIds - 排序后的全部可见歌曲 ID
 * @returns 可持久化的完整歌曲 ID 顺序
 */
export const reorderVisibleIds = (
  ids: readonly string[],
  visibleIds: readonly string[],
  orderedIds: readonly string[],
): string[] => {
  const visible = new Set(visibleIds);
  if (
    visible.size !== visibleIds.length ||
    orderedIds.length !== visible.size ||
    new Set(orderedIds).size !== visible.size ||
    orderedIds.some((id) => !visible.has(id))
  ) {
    throw new Error("歌单内容已变化，请刷新后重试");
  }
  let index = 0;
  const result = ids.map((id) => (visible.has(id) ? orderedIds[index++] : id));
  if (index !== orderedIds.length) throw new Error("歌单内容已变化，请刷新后重试");
  return result;
};
