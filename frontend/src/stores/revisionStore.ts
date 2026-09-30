import { defineStore } from 'pinia';
import { db } from '../utils/db';
import { uid } from '../utils/id';
import { toPlain } from '../utils/plain';
import type { Revision, RevisionCounts } from '../types/revision';

/**
 * 仅测试用：在封存事务写入修订后、搬运工作台行前注入失败，
 * 验证事务回滚不会留下半套修订。生产代码不设置。
 */
let freezeFailureHook: (() => void) | null = null;
export function __setFreezeFailureHookForTest(hook: (() => void) | null): void {
  freezeFailureHook = hook;
}

interface RevisionState {
  revisions: Revision[];
  hydrated: boolean;
}

/**
 * 修订档案所有权：
 * - revisions 表保存每张琴的封存修订（sealed，只读快照）与开放修订（open，工作台）；
 * - 四张工序表的行只属于 open 修订；封存时快照入 sealed 文档，
 *   旧行复制到自动续开的下一 open 修订，旧验收结果不会再被施工顶掉。
 */
export const useRevisionStore = defineStore('revision', {
  state: (): RevisionState => ({ revisions: [], hydrated: false }),

  getters: {
    /** 某张琴的当前开放修订（工作台归属） */
    openByGuqin(state) {
      return (guqinNo: string): Revision | undefined =>
        state.revisions.find((r) => r.guqinNo === guqinNo && r.status === 'open');
    },
    /** 某张琴的全部修订，按版本号倒序（最新在前） */
    revisionsOf(state) {
      return (guqinNo: string): Revision[] =>
        state.revisions
          .filter((r) => r.guqinNo === guqinNo)
          .sort((a, b) => b.revNo - a.revNo || b.frozenAt.localeCompare(a.frozenAt));
    },
    /** 档案页分组：每张琴一条，含当前开放修订与封存历史 */
    grouped(state): Array<{ guqinNo: string; open?: Revision; sealed: Revision[] }> {
      const map = new Map<string, { guqinNo: string; open?: Revision; sealed: Revision[] }>();
      state.revisions.forEach((rev) => {
        let g = map.get(rev.guqinNo);
        if (!g) {
          g = { guqinNo: rev.guqinNo, sealed: [] };
          map.set(rev.guqinNo, g);
        }
        if (rev.status === 'open') g.open = rev;
        else g.sealed.push(rev);
      });
      return Array.from(map.values())
        .map((g) => ({ ...g, sealed: g.sealed.sort((a, b) => b.revNo - a.revNo) }))
        .sort((a, b) => a.guqinNo.localeCompare(b.guqinNo));
    },
    sealedCount(state): number {
      return state.revisions.filter((r) => r.status === 'sealed').length;
    },
  },

  actions: {
    async hydrate() {
      this.revisions = await db.revisions.orderBy('frozenAt').toArray();
      this.hydrated = true;
    },

    /** 某琴下一可用版本号 */
    nextRevNo(guqinNo: string): number {
      return this.revisions.filter((r) => r.guqinNo === guqinNo).reduce((max, r) => Math.max(max, r.revNo), 0) + 1;
    },

    /**
     * 确保某张琴存在开放修订；没有就新开一版。
     * 全新琴从「初版」开始；封过存的琴沿上一封存修订续开。
     */
    async ensureOpen(guqinNo: string): Promise<Revision> {
      const no = guqinNo.trim();
      const existed = this.revisions.find((r) => r.guqinNo === no && r.status === 'open');
      if (existed) return existed;

      const priorSealed = this.revisions
        .filter((r) => r.guqinNo === no && r.status === 'sealed')
        .sort((a, b) => b.revNo - a.revNo)[0];

      const rev: Revision = {
        id: uid('rev'),
        guqinNo: no,
        revNo: this.nextRevNo(no),
        status: 'open',
        frozenAt: new Date().toISOString(),
        sourceRevisionId: priorSealed?.id,
        boards: [],
        chambers: [],
        lacquers: [],
        stringings: [],
        counts: { boards: 0, chambers: 0, lacquers: 0, stringings: 0 },
      };
      await db.revisions.put(toPlain(rev));
      this.revisions = [...this.revisions, rev];
      return rev;
    },

    /**
     * 封存某琴当前开放修订：四类工作台行生成只读快照，随后自动续开下一修订。
     * 全程单个 IndexedDB 事务：任一步失败则封存与续开一起回滚，工作台维持原样。
     */
    async freeze(guqinNo: string, note?: string): Promise<{ sealed: Revision; openNext: Revision; counts: RevisionCounts }> {
      const no = guqinNo.trim();
      const open = this.revisions.find((r) => r.guqinNo === no && r.status === 'open');
      if (!open) {
        throw new Error(`琴号 ${no} 没有开放中的修订，无法封存`);
      }

      const [boards, chambers, lacquers, stringings] = await Promise.all([
        db.boards.where('revisionId').equals(open.id).toArray(),
        db.chambers.where('revisionId').equals(open.id).toArray(),
        db.lacquers.where('revisionId').equals(open.id).toArray(),
        db.stringings.where('revisionId').equals(open.id).toArray(),
      ]);

      const counts: RevisionCounts = {
        boards: boards.length,
        chambers: chambers.length,
        lacquers: lacquers.length,
        stringings: stringings.length,
      };
      const total = counts.boards + counts.chambers + counts.lacquers + counts.stringings;
      if (total === 0) {
        throw new Error('当前修订没有任何工序记录，无需封存');
      }

      const frozenAt = new Date().toISOString();
      const sealed: Revision = {
        ...open,
        status: 'sealed',
        frozenAt,
        note: note?.trim() || open.note,
        // 快照深拷贝，与续开后的工作台行彻底分家
        boards: JSON.parse(JSON.stringify(boards)) as Revision['boards'],
        chambers: JSON.parse(JSON.stringify(chambers)) as Revision['chambers'],
        lacquers: JSON.parse(JSON.stringify(lacquers)) as Revision['lacquers'],
        stringings: JSON.parse(JSON.stringify(stringings)) as Revision['stringings'],
        counts,
      };

      const openNext: Revision = {
        id: uid('rev'),
        guqinNo: no,
        revNo: open.revNo + 1,
        status: 'open',
        frozenAt,
        sourceRevisionId: sealed.id,
        boards: [],
        chambers: [],
        lacquers: [],
        stringings: [],
        // 续开时的条数快照（页面另以四张工作台表实时计数为准）
        counts,
      };

      // 续开工作台行：新 id、归属新修订，业务字段（含遍次/累计厚度/评语历史）原样保留
      const carryBoards = boards.map((b) => ({ ...JSON.parse(JSON.stringify(b)), id: uid('board'), revisionId: openNext.id }));
      const carryChambers = chambers.map((c) => ({ ...JSON.parse(JSON.stringify(c)), id: uid('chamber'), revisionId: openNext.id }));
      const carryLacquers = lacquers.map((l) => ({ ...JSON.parse(JSON.stringify(l)), id: uid('layer'), revisionId: openNext.id }));
      const carryStringings = stringings.map((s) => ({ ...JSON.parse(JSON.stringify(s)), id: uid('stringing'), revisionId: openNext.id }));

      await db.transaction(
        'rw',
        db.revisions,
        db.boards,
        db.chambers,
        db.lacquers,
        db.stringings,
        async () => {
          await db.revisions.put(toPlain(sealed));
          await db.revisions.put(toPlain(openNext));
          freezeFailureHook?.();
          await Promise.all([
            db.boards.where('revisionId').equals(open.id).delete(),
            db.chambers.where('revisionId').equals(open.id).delete(),
            db.lacquers.where('revisionId').equals(open.id).delete(),
            db.stringings.where('revisionId').equals(open.id).delete(),
          ]);
          if (carryBoards.length) await db.boards.bulkAdd(toPlain(carryBoards));
          if (carryChambers.length) await db.chambers.bulkAdd(toPlain(carryChambers));
          if (carryLacquers.length) await db.lacquers.bulkAdd(toPlain(carryLacquers));
          if (carryStringings.length) await db.stringings.bulkAdd(toPlain(carryStringings));
        },
      );

      this.revisions = [...this.revisions.filter((r) => r.id !== open.id), sealed, openNext];
      return { sealed, openNext, counts };
    },
  },
});
