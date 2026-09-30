import { defineStore } from 'pinia';
import { db } from '../utils/db';
import { uid } from '../utils/id';
import { toPlain } from '../utils/plain';
import { cumulativeThickness, nextSeq, sortLayers } from '../utils/layer';
import { useRevisionStore } from './revisionStore';
import type { LacquerLayer } from '../types/lacquer-layer';

export interface LacquerInput {
  guqinNo: string;
  mixRatio: string;
  curingTemp: number;
  curingHumidity: number;
  polishGrit: number;
  layerThickness: number;
  appliedAt?: string;
  operator: string;
  remark?: string;
}

interface LacquerState {
  layers: LacquerLayer[];
  hydrated: boolean;
}

/** 髹漆遍次与累计厚度 */
export const useLacquerStore = defineStore('lacquer', {
  state: (): LacquerState => ({ layers: [], hydrated: false }),

  getters: {
    scopedLayers(state): LacquerLayer[] {
      const revisionId = useRevisionStore().viewingId;
      return state.layers.filter((l) => l.revisionId === revisionId);
    },
    layersOf() {
      return (guqinNo: string): LacquerLayer[] =>
        sortLayers(this.scopedLayers.filter((l: LacquerLayer) => l.guqinNo === guqinNo));
    },
    /** 该琴当前累计厚度（mm） */
    totalOf() {
      return (guqinNo: string): number =>
        cumulativeThickness(this.scopedLayers.filter((l: LacquerLayer) => l.guqinNo === guqinNo));
    },
    guqinNos(): string[] {
      return Array.from(new Set(this.scopedLayers.map((l: LacquerLayer) => l.guqinNo))).sort();
    },
    /** 荫房温湿度超窗口的遍次数量 */
    outOfRangeCount(): number {
      return this.scopedLayers.filter(
        (l: LacquerLayer) =>
          !(l.curingTemp >= 20 && l.curingTemp <= 30 && l.curingHumidity >= 70 && l.curingHumidity <= 85),
      ).length;
    },
  },

  actions: {
    async hydrate() {
      this.layers = await db.lacquers.toArray();
      this.hydrated = true;
    },

    _draftRevisionId(): string {
      const revisionStore = useRevisionStore();
      const draft = revisionStore.currentDraft;
      if (!draft || revisionStore.viewingId !== draft.id) {
        throw new Error('封存修订只读：继续施工请先在顶栏开新修订（封存当前工作台）');
      }
      return draft.id;
    },

    /** 追加一遍：遍次自动 +1，并重算该琴累计厚度 */
    async appendLayer(input: LacquerInput): Promise<LacquerLayer> {
      const revisionId = this._draftRevisionId();
      const siblings = this.layers.filter(
        (l) => l.revisionId === revisionId && l.guqinNo === input.guqinNo,
      );
      const layer: LacquerLayer = {
        id: uid('layer'),
        revisionId,
        guqinNo: input.guqinNo.trim(),
        seq: nextSeq(siblings),
        mixRatio: input.mixRatio,
        curingTemp: Number(input.curingTemp) || 0,
        curingHumidity: Number(input.curingHumidity) || 0,
        polishGrit: Number(input.polishGrit) || 0,
        layerThickness: Number(input.layerThickness) || 0,
        totalThickness: 0,
        appliedAt: input.appliedAt ?? new Date().toISOString(),
        operator: input.operator.trim(),
        remark: input.remark?.trim() || undefined,
      };
      const next = [...siblings, layer];
      const withTotals = next.map((item) => ({
        ...item,
        totalThickness: cumulativeThickness(next, item.seq),
      }));
      for (const item of withTotals) {
        await db.lacquers.put(toPlain(item));
      }
      const others = this.layers.filter((l) => l.revisionId !== revisionId || l.guqinNo !== input.guqinNo);
      this.layers = [...others, ...withTotals];
      return withTotals.find((item) => item.id === layer.id)!;
    },

    async updateLayer(id: string, patch: Partial<LacquerInput>) {
      this._draftRevisionId();
      const current = this.layers.find((l) => l.id === id);
      if (!current || current.revisionId !== useRevisionStore().viewingId) return;
      const revisionId = current.revisionId;
      const next: LacquerLayer = { ...current, ...patch };
      const siblings = this.layers
        .filter((l) => l.revisionId === revisionId && l.guqinNo === next.guqinNo)
        .map((l) => (l.id === id ? next : l));
      const withTotals = siblings.map((item) => ({ ...item, totalThickness: cumulativeThickness(siblings, item.seq) }));
      for (const item of withTotals) {
        await db.lacquers.put(toPlain(item));
      }
      this.layers = this.layers.map((l) => withTotals.find((w) => w.id === l.id) ?? l);
    },

    async removeLayer(id: string) {
      this._draftRevisionId();
      const current = this.layers.find((l) => l.id === id);
      if (!current || current.revisionId !== useRevisionStore().viewingId) return;
      await db.lacquers.delete(id);
      const rest = this.layers.filter((l) => l.id !== id);
      const siblings = rest.filter((l) => l.revisionId === current.revisionId && l.guqinNo === current.guqinNo);
      const withTotals = siblings.map((item) => ({ ...item, totalThickness: cumulativeThickness(siblings, item.seq) }));
      for (const item of withTotals) {
        await db.lacquers.put(toPlain(item));
      }
      this.layers = rest.map((l) => withTotals.find((w) => w.id === l.id) ?? l);
    },
  },
});
