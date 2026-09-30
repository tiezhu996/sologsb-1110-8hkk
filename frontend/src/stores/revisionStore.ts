import { defineStore } from 'pinia';
import { db, RECORD_TABLES } from '../utils/db';
import { toPlain } from '../utils/plain';
import { createRevision, cloneRowForRevision, FIRST_REVISION_ID } from '../utils/revision';
import type { Revision } from '../types/revision';

interface RevisionState {
  revisions: Revision[];
  /** 当前正在查看的修订 id；默认当前工作台 draft，也可切到某份封存只读修订 */
  viewingId: string;
  hydrated: boolean;
}

/**
 * 修订所有权：四类工序记录都只属于某一份修订。
 * - draft（工作台）：可继续施工、可增删改；
 * - sealed（封存）：只读快照，只用于查看；
 * - 封存 = 把当前 draft 置为 sealed 并复制出下一份 draft，四类记录整体复制、
 *   旧验收结果留在封存修订中，不会再被新数据顶掉。
 */
export const useRevisionStore = defineStore('revision', {
  state: (): RevisionState => ({ revisions: [], viewingId: '', hydrated: false }),

  getters: {
    ordered(state): Revision[] {
      return [...state.revisions].sort((a, b) => b.no - a.no);
    },
    /** 当前工作台修订（唯一 draft） */
    currentDraft(state): Revision | undefined {
      return state.revisions.find((r) => r.status === 'draft');
    },
    /** 历史封存修订（新封存的在前） */
    sealedRevisions(): Revision[] {
      return this.ordered.filter((r: Revision) => r.status === 'sealed');
    },
    viewing(state): Revision | undefined {
      return state.revisions.find((r) => r.id === state.viewingId);
    },
    /** 当前查看的是否为可写工作台 */
    isViewingDraft(): boolean {
      return this.viewing?.status === 'draft';
    },
    byId(state) {
      return (id: string): Revision | undefined => state.revisions.find((r) => r.id === id);
    },
    labelOf(state) {
      return (id: string): string => state.revisions.find((r) => r.id === id)?.label ?? '?';
    },
  },

  actions: {
    async hydrate() {
      this.revisions = (await db.revisions.toArray()).sort((a, b) => a.no - b.no);
      if (!this.viewingId || !this.revisions.some((r) => r.id === this.viewingId)) {
        this.viewingId = this.currentDraft?.id ?? this.revisions[0]?.id ?? '';
      }
      this.hydrated = true;
    },

    /**
     * 启动时保证修订数据自洽（幂等）。
     * - 全新库：先不开修订，等示例数据写入后由 seed 流程携带创建；
     * - 已升级库：必有初版 R001；若 revisions 为空（异常半套库），用现有四类
     *   记录按修订归属自洽重建，下次打开不会停在半套新库状态。
     */
    async bootstrap() {
      const existing = await db.revisions.toArray();
      if (existing.length) {
        await this.hydrate();
        return;
      }

      const counts = await Promise.all(RECORD_TABLES.map((name) => db.table(name).count()));
      const hasRecords = counts.some((n) => n > 0);
      if (!hasRecords) {
        // 全新库：seedIfEmpty 会连同初版一起写入
        this.revisions = [];
        this.viewingId = '';
        this.hydrated = true;
        return;
      }

      // 异常自洽：有四类记录却没有修订行（理论上 v3 升级事务原子提交不会出现）
      const revision = createRevision(1);
      await db.revisions.put(toPlain(revision));
      for (const name of RECORD_TABLES) {
        await db
          .table(name)
          .toCollection()
          .modify((row: { revisionId?: string }) => {
            if (!row.revisionId) row.revisionId = FIRST_REVISION_ID;
          });
      }
      this.revisions = [revision];
      this.viewingId = revision.id;
      this.hydrated = true;
    },

    /** 全新库首次播种时创建初版修订 */
    async ensureFirstForSeed(): Promise<string> {
      let revision = await db.revisions.get(FIRST_REVISION_ID);
      if (!revision) {
        revision = createRevision(1);
        await db.revisions.put(toPlain(revision));
      }
      this.revisions = [revision];
      this.viewingId = revision.id;
      this.hydrated = true;
      return revision.id;
    },

    /** 切到某份修订查看（封存修订只读） */
    setViewing(id: string) {
      if (this.revisions.some((r) => r.id === id)) {
        this.viewingId = id;
      }
    },

    /**
     * 封存当前工作台：当前 draft → sealed，并把四类记录复制进新开的 draft。
     * 全程一条 IndexedDB 事务：失败则封存与开新修订都不生效，工作台保持原状。
     */
    async sealCurrent(input: { note?: string; sealedBy?: string } = {}): Promise<Revision> {
      const draft = this.currentDraft;
      if (!draft) throw new Error('没有可封存的工作台修订');

      const sealedAt = new Date().toISOString();
      const sealed: Revision = {
        ...draft,
        status: 'sealed',
        sealedAt,
        sealedBy: input.sealedBy?.trim() || undefined,
        note: input.note?.trim() || draft.note,
      };
      const next = createRevision(draft.no + 1, draft.id);

      const [boards, chambers, lacquers, stringings] = await Promise.all([
        db.boards.where('revisionId').equals(draft.id).toArray(),
        db.chambers.where('revisionId').equals(draft.id).toArray(),
        db.lacquers.where('revisionId').equals(draft.id).toArray(),
        db.stringings.where('revisionId').equals(draft.id).toArray(),
      ]);

      await db.transaction(
        'rw',
        [db.revisions, db.boards, db.chambers, db.lacquers, db.stringings],
        async () => {
          await db.revisions.put(toPlain(sealed));
          await db.revisions.add(toPlain(next));
          if (boards.length) {
            await db.boards.bulkPut(boards.map((row) => toPlain(cloneRowForRevision(row, next.id, 'board'))));
          }
          if (chambers.length) {
            await db.chambers.bulkPut(chambers.map((row) => toPlain(cloneRowForRevision(row, next.id, 'chamber'))));
          }
          if (lacquers.length) {
            await db.lacquers.bulkPut(lacquers.map((row) => toPlain(cloneRowForRevision(row, next.id, 'layer'))));
          }
          if (stringings.length) {
            await db.stringings.bulkPut(stringings.map((row) => toPlain(cloneRowForRevision(row, next.id, 'stringing'))));
          }
        },
      );

      this.revisions = [...this.revisions.filter((r) => r.id !== draft.id), sealed, next].sort((a, b) => a.no - b.no);
      this.viewingId = next.id;
      return next;
    },
  },
});
