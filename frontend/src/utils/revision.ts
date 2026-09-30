import { revisionLabel, type Revision } from '../types/revision';
import { uid } from './id';

/** 初版修订固定 id：旧库升级后四类记录都挂到它名下 */
export const FIRST_REVISION_ID = 'rev-0001';

/** 创建一份新修订 */
export function createRevision(no: number, prevId?: string): Revision {
  const now = new Date().toISOString();
  return {
    id: no === 1 ? FIRST_REVISION_ID : uid('rev'),
    no,
    label: revisionLabel(no),
    status: 'draft',
    createdAt: now,
    prevId,
  };
}

/**
 * 开新修订时把四类记录复制一份：主键重新分配（不同修订各自持有自己的记录行），
 * 记录归属改为新修订 id；嵌套结构（如评语历史版本）保留原 id 即可。
 */
export function cloneRowForRevision<T extends { id: string; revisionId: string }>(
  row: T,
  nextRevisionId: string,
  prefix: string,
): T {
  const clone: Record<string, unknown> = { ...row, id: uid(prefix), revisionId: nextRevisionId };
  return clone as T;
}
