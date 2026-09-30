import { defineStore } from 'pinia';
import { db, type OwnedWoodBoard } from '../utils/db';
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
  boards: OwnedWoodBoard[];
  hydrated: boolean;
}

/** 板材与面板/底板配对（仅含当前各琴开放修订的工作台数据） */
export const useBoardStore = defineStore('board', {
  state: (): BoardState => ({ boards: [], hydrated: false }),

  getters: {
    /** 面板与底板按琴号配对并回显含水率 */
    pairs(state): BoardPair[] {
      return pairBoards(state.boards);
    },
    /** 可用板材数（无裂纹且阴干达标） */
    usableCount(state): number {
      return state.boards.filter(boardUsable).length;
    },
    guqinNos(state): string[] {
      return Array.from(new Set(state.boards.map((b) => b.guqinNo))).sort();
    },
    boardsOf(state) {
      return (guqinNo: string): WoodBoard[] => state.boards.filter((b) => b.guqinNo === guqinNo);
    },
  },

  actions: {
    async hydrate() {
      this.boards = await db.boards.orderBy('boardNo').toArray();
      this.hydrated = true;
    },

    async addBoard(input: BoardInput): Promise<OwnedWoodBoard> {
      const revisionStore = useRevisionStore();
      const revision = await revisionStore.ensureOpen(input.guqinNo);
      const board: OwnedWoodBoard = {
        id: uid('board'),
        revisionId: revision.id,
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
      const current = this.boards.find((b) => b.id === id);
      if (!current) return;
      // 改琴号即归到目标琴号的开放修订
      let revisionId = current.revisionId;
      if (patch.guqinNo && patch.guqinNo.trim() !== current.guqinNo) {
        revisionId = (await useRevisionStore().ensureOpen(patch.guqinNo)).id;
      }
      const next: OwnedWoodBoard = { ...current, ...patch, revisionId };
      await db.boards.put(toPlain(next));
      this.boards = this.boards.map((b) => (b.id === id ? next : b));
    },

    async removeBoard(id: string) {
      await db.boards.delete(id);
      this.boards = this.boards.filter((b) => b.id !== id);
    },

    /** 配对绑定：把底板并入面板所在琴号的开放修订 */
    async pair(panelId: string, baseId: string) {
      const panel = this.boards.find((b) => b.id === panelId);
      const base = this.boards.find((b) => b.id === baseId);
      if (!panel || !base) return;
      const guqinNo = panel.guqinNo;
      const revision = await useRevisionStore().ensureOpen(guqinNo);
      const updated = [panel, base].map((b) => ({ ...b, guqinNo, revisionId: revision.id }));
      for (const board of updated) {
        await db.boards.put(toPlain(board));
      }
      this.boards = this.boards.map((b) => updated.find((u) => u.id === b.id) ?? b);
    },
  },
});
