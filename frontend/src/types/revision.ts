import type { WoodBoard } from './wood-board';
import type { SoundChamber } from './sound-chamber';
import type { LacquerLayer } from './lacquer-layer';
import type { Stringing } from './stringing';

/** 修订状态：sealed=已封存只读；open=当前工作台开放修订（可继续施工） */
export type RevisionStatus = 'sealed' | 'open';

/**
 * 封存修订（只读档案）。
 *
 * 所有权约定：
 * - 四类工序行（boards / chambers / lacquers / stringings）只属于「开放修订」，
 *   工作台只读写 open 修订；
 * - 封存时把四类行整体快照进本文档并置为 sealed，此后任何施工都改不到旧验收结果；
 * - 快照内记录保持封存那一刻的 id 与全部字段（含累计厚度、评语历史），只供查看。
 */
export interface Revision {
  /** 修订 id（rev-…） */
  id: string;
  /** 琴号 */
  guqinNo: string;
  /** 修订序号（每张琴从 1 起，封一次 +1） */
  revNo: number;
  /** sealed / open */
  status: RevisionStatus;
  /** 封存时间（open 修订为开启时间）ISO */
  frozenAt: string;
  /** 封存说明（如阶段验收名） */
  note?: string;
  /** 由哪一修订封存续开（开放修订指向被封存的前一修订 id） */
  sourceRevisionId?: string;
  /** 四类记录快照（open 修订同样持有空数组占位，工作台数据以四张表为准） */
  boards: WoodBoard[];
  chambers: SoundChamber[];
  lacquers: LacquerLayer[];
  stringings: Stringing[];
  /** 快照条数，列表页不用展开即可显示 */
  counts: RevisionCounts;
}

export interface RevisionCounts {
  boards: number;
  chambers: number;
  lacquers: number;
  stringings: number;
}

/** 修订标签，如「初版 / 第 3 版」 */
export function revLabel(revNo: number): string {
  return revNo <= 1 ? '初版' : `第 ${revNo} 版`;
}
