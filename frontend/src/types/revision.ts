/** 修订状态：draft=工作台（可改写），sealed=封存（只读） */
export type RevisionStatus = 'draft' | 'sealed';

/**
 * 工序档案修订。
 * - 工作台只有一份 draft：板材 / 槽腹 / 髹漆 / 上弦四类记录都落在这份修订上继续施工；
 * - 封存时把当前 draft 置为 sealed（只读快照），四类记录原样归属该修订、不再被改写；
 * - 继续施工需开下一份 draft：把四类记录复制进新修订，旧验收结果留在历史修订中可随时查看。
 */
export interface Revision {
  id: string;
  /** 修订号（从 1 开始，递增） */
  no: number;
  /** 修订标签，如 R001 */
  label: string;
  status: RevisionStatus;
  /** 封存说明（封存时可填） */
  note?: string;
  /** 修订创建时间 ISO */
  createdAt: string;
  /** 封存时间 ISO（draft 时为空） */
  sealedAt?: string;
  /** 封存操作人 */
  sealedBy?: string;
  /** 上一修订 id（首版为空） */
  prevId?: string;
}

export const REVISION_LABEL_PREFIX = 'R';

/** 修订号 → 展示标签：1 → R001 */
export function revisionLabel(no: number): string {
  return `${REVISION_LABEL_PREFIX}${String(no).padStart(3, '0')}`;
}
