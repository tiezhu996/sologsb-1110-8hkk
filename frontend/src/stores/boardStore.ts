import { defineStore } from 'pinia';
import { db } from '../utils/db';
import { uid } from '../utils/id';
import { toPlain } from '../utils/plain';
import { pairBoards, boardUsable } from '../utils/wood';
import { useRevisionStore } from './revisionStore';
import type { BoardPart, BoardPair, WoodBoard, WoodDefect, WoodGrain, WoodSpecies } from '../types/wood-board';

export interface BoardInput {
  boardNo: string;
  guqinNo: string;
  part: BoardPart;
  species: WoodSpecies;
  dryYears: number;
  thicknessMm: number;
  grain: WoodGrain;
  defect: WoodDefect;
  receivedAt?: string;
  remark?: string;
}

interface BoardState {
  boards: WoodBoard[];
  hydrated: boolean;
}

/** 板材与面板/底板配对 */
export const useBoardStore = defineStore('board', {
  state: (): BoardState => ({ boards: [], hydrated: false }),

  getters: {
    /** 当前查看修订下的板材（封存修订为只读快照） */
    scopedBoards(state): WoodBoard[] {
      const revisionId = useRevisionStore().viewingId;
      return state.boards.filter((b) => b.revisionId === revisionId);
    },
    /** 面板与底板按琴号配对并回显含水率 */
    pairs(): BoardPair[] {
      return pairBoards(this.scopedBoards);
    },
    /** 可用板材数（无裂纹且阴干达标） */
    usableCount(): number {
      return this.scopedBoards.filter(boardUsable).length;
    },
    guqinNos(): string[] {
      return Array.from(new Set(this.scopedBoards.map((b: WoodBoard) => b.guqinNo))).sort();
    },
    boardsOf() {
      return (guqinNo: string): WoodBoard[] => this.scopedBoards.filter((b: WoodBoard) => b.guqinNo === guqinNo);
    },
  },

  actions: {
    async hydrate() {
      this.boards = await db.boards.orderBy('boardNo').toArray();
      this.hydrated = true;
    },

    /** 仅当前工作台（draft）可写；查看封存修订时拒绝写入 */
    _draftRevisionId(): string {
      const revisionStore = useRevisionStore();
      const draft = revisionStore.currentDraft;
      if (!draft || revisionStore.viewingId !== draft.id) {
        throw new Error('封存修订只读：继续施工请先在顶栏开新修订（封存当前工作台）');
      }
      return draft.id;
    },

    async addBoard(input: BoardInput): Promise<WoodBoard> {
      const revisionId = this._draftRevisionId();
      const board: WoodBoard = {
        id: uid('board'),
        revisionId,
        boardNo: input.boardNo.trim(),
        guqinNo: input.guqinNo.trim(),
        part: input.part,
        species: input.species,
        dryYears: Number(input.dryYears) || 0,
        thicknessMm: Number(input.thicknessMm) || 0,
        grain: input.grain,
        defect: input.defect,
        receivedAt: input.receivedAt ?? new Date().toISOString(),
        remark: input.remark?.trim() || undefined,
      };
      await db.boards.put(toPlain(board));
      this.boards = [board, ...this.boards];
      return board;
    },

    async updateBoard(id: string, patch: Partial<BoardInput>) {
      this._draftRevisionId();
      const current = this.boards.find((b) => b.id === id);
      if (!current) return;
      if (current.revisionId !== useRevisionStore().viewingId) return;
      const next: WoodBoard = { ...current, ...patch };
      await db.boards.put(toPlain(next));
      this.boards = this.boards.map((b) => (b.id === id ? next : b));
    },

    async removeBoard(id: string) {
      this._draftRevisionId();
      const current = this.boards.find((b) => b.id === id);
      if (!current || current.revisionId !== useRevisionStore().viewingId) return;
      await db.boards.delete(id);
      this.boards = this.boards.filter((b) => b.id !== id);
    },

    /** 配对绑定：把某块板材与同琴号的另一部位板材绑定 */
    async pair(panelId: string, baseId: string) {
      this._draftRevisionId();
      const revisionId = useRevisionStore().viewingId;
      const panel = this.boards.find((b) => b.id === panelId);
      const base = this.boards.find((b) => b.id === baseId);
      if (!panel || !base || panel.revisionId !== revisionId || base.revisionId !== revisionId) return;
      const guqinNo = panel.guqinNo;
      const updated = [panel, base].map((b) => ({ ...b, guqinNo }));
      for (const board of updated) {
        await db.boards.put(toPlain(board));
      }
      this.boards = this.boards.map((b) => updated.find((u) => u.id === b.id) ?? b);
    },
  },
});
