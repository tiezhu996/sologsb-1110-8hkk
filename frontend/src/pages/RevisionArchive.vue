<script setup lang="ts">
import { computed, ref } from 'vue';
import StatBadge from '../components/common/StatBadge.vue';
import EmptyPanel from '../components/common/EmptyPanel.vue';
import LayerStack from '../components/common/LayerStack.vue';
import { useRevisionStore } from '../stores/revisionStore';
import { useBoardStore } from '../stores/boardStore';
import { useChamberStore } from '../stores/chamberStore';
import { useLacquerStore } from '../stores/lacquerStore';
import { useStringingStore } from '../stores/stringingStore';
import { freezeRevision } from '../hooks/useFreezeRevision';
import { formatDate, cumulativeThickness } from '../utils/layer';
import { thicknessGap } from '../utils/wood';
import { revLabel, type Revision } from '../types/revision';

const revisionStore = useRevisionStore();
const boardStore = useBoardStore();
const chamberStore = useChamberStore();
const lacquerStore = useLacquerStore();
const stringingStore = useStringingStore();

const keyword = ref('');
const viewing = ref<Revision | null>(null);
const drawerVisible = computed({
  get: () => viewing.value !== null,
  set: (v: boolean) => {
    if (!v) viewing.value = null;
  },
});

const groups = computed(() => {
  const kw = keyword.value.trim().toLowerCase();
  if (!kw) return revisionStore.grouped;
  return revisionStore.grouped.filter((g) => g.guqinNo.toLowerCase().includes(kw));
});

/** 当前开放修订下，工作台未封存的四类记录总数 */
const pendingRecords = computed(() =>
  revisionStore.revisions
    .filter((r) => r.status === 'open')
    .reduce(
      (sum, r) =>
        sum +
        boardStore.boards.filter((b) => b.revisionId === r.id).length +
        chamberStore.chambers.filter((c) => c.revisionId === r.id).length +
        lacquerStore.layers.filter((l) => l.revisionId === r.id).length +
        stringingStore.stringings.filter((s) => s.revisionId === r.id).length,
      0,
    ),
);

/** 当前开放修订的工作台实时条数（封存快照的 counts 不随后续施工变化） */
function liveCounts(openId: string) {
  return {
    boards: boardStore.boards.filter((b) => b.revisionId === openId).length,
    chambers: chamberStore.chambers.filter((c) => c.revisionId === openId).length,
    lacquers: lacquerStore.layers.filter((l) => l.revisionId === openId).length,
    stringings: stringingStore.stringings.filter((s) => s.revisionId === openId).length,
  };
}

const view = computed(() => {
  const rev = viewing.value;
  if (!rev) return null;
  return {
    boards: rev.boards,
    chambers: rev.chambers,
    layers: [...rev.lacquers].sort((a, b) => a.seq - b.seq),
    stringings: rev.stringings,
    total: cumulativeThickness(rev.lacquers),
    panel: rev.boards.find((b) => b.part === '面板'),
    base: rev.boards.find((b) => b.part === '底板'),
  };
});

async function handleFreeze(guqinNo: string) {
  await freezeRevision(guqinNo);
}

function openView(rev: Revision) {
  viewing.value = rev;
}
</script>

<template>
  <div>
    <h2 class="page-title">修订档案与封存</h2>
    <p class="page-desc">
      工作台只保存每张琴当前开放修订的板材 / 槽腹 / 髹漆 / 上弦记录；封存后生成只读修订，旧验收结果不再被继续施工顶掉，并自动续开下一版。
    </p>

    <el-row :gutter="12" class="stat-row">
      <el-col :xs="12" :md="8">
        <StatBadge label="在制琴（开放修订）" :value="groups.filter((g) => g.open).length" unit="张" />
      </el-col>
      <el-col :xs="12" :md="8">
        <StatBadge label="已封存修订" :value="revisionStore.sealedCount" unit="个" status="success" />
      </el-col>
      <el-col :xs="12" :md="8">
        <StatBadge label="工作台待封存记录" :value="pendingRecords" unit="条" status="warning" />
      </el-col>
    </el-row>

    <div class="toolbar">
      <el-input v-model="keyword" placeholder="按琴号检索" clearable style="width: 220px" />
      <span class="hint">封存即冻结四类记录并续开新版，历史修订可随时只读查看</span>
    </div>

    <EmptyPanel v-if="groups.length === 0" description="暂无修订档案" />

    <el-card v-for="g in groups" :key="g.guqinNo" shadow="never" class="block">
      <template #header>
        <div class="card-head">
          <span class="guqin-no">{{ g.guqinNo }}</span>
          <el-button v-if="g.open" type="warning" size="small" @click="handleFreeze(g.guqinNo)">
            封存{{ revLabel(g.open.revNo) }}并续开{{ revLabel(g.open.revNo + 1) }}
          </el-button>
        </div>
      </template>

      <div v-if="g.open" class="open-line">
        <el-tag type="warning" effect="dark" size="small">当前修订 · {{ revLabel(g.open.revNo) }}（开放）</el-tag>
        <span class="meta">开启 {{ formatDate(g.open.frozenAt) }}</span>
        <span class="meta">
          工作台实时：板材 {{ liveCounts(g.open.id).boards }} · 槽腹 {{ liveCounts(g.open.id).chambers }} ·
          髹漆 {{ liveCounts(g.open.id).lacquers }} 遍 · 上弦 {{ liveCounts(g.open.id).stringings }}
        </span>
      </div>
      <el-divider v-if="g.sealed.length" style="margin: 10px 0" />
      <el-table v-if="g.sealed.length" :data="g.sealed" size="small" border>
        <el-table-column label="修订" width="110">
          <template #default="scope">
            <el-tag type="success" effect="plain" size="small">{{ revLabel(scope.row.revNo) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="封存时间" width="120">
          <template #default="scope">{{ formatDate(scope.row.frozenAt) }}</template>
        </el-table-column>
        <el-table-column prop="note" label="封存说明" min-width="180" show-overflow-tooltip />
        <el-table-column label="记录条数" min-width="230">
          <template #default="scope">
            板材 {{ scope.row.counts.boards }} · 槽腹 {{ scope.row.counts.chambers }} · 髹漆
            {{ scope.row.counts.lacquers }} 遍 · 上弦 {{ scope.row.counts.stringings }}
          </template>
        </el-table-column>
        <el-table-column label="操作" width="100">
          <template #default="scope">
            <el-button link type="primary" @click="openView(scope.row)">只读查看</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-drawer
      v-model="drawerVisible"
      :title="viewing ? `${viewing.guqinNo} · ${revLabel(viewing.revNo)}（只读封存档案）` : ''"
      size="62%"
    >
      <div v-if="view && viewing" class="view-body">
        <el-alert
          type="success"
          :closable="false"
          show-icon
          class="readonly-alert"
          :title="`封存于 ${formatDate(viewing.frozenAt)}${viewing.note ? ' · ' + viewing.note : ''}；本修订只读，继续施工请回到工作台当前修订。`"
        />

        <h4>板材（{{ view.boards.length }}）</h4>
        <el-table :data="view.boards" size="small" border>
          <el-table-column prop="boardNo" label="板材号" width="110" />
          <el-table-column prop="part" label="部位" width="70" />
          <el-table-column prop="species" label="树种" width="70" />
          <el-table-column prop="thicknessMm" label="厚度(mm)" width="90" />
          <el-table-column prop="grain" label="木纹" width="80" />
          <el-table-column prop="defect" label="缺陷" width="70" />
          <el-table-column label="入库" width="100">
            <template #default="scope">{{ formatDate(scope.row.receivedAt) }}</template>
          </el-table-column>
          <el-table-column prop="remark" label="备注" min-width="100" />
        </el-table>
        <p v-if="view.panel && view.base" class="pair-note">
          面底板厚差
          {{
            thicknessGap({
              guqinNo: viewing.guqinNo,
              panel: view.panel,
              base: view.base,
              species: view.panel.species,
              moisturePct: 0,
              matched: true,
            })
          }}
          mm
        </p>

        <h4>槽腹（{{ view.chambers.length }}）</h4>
        <el-table :data="view.chambers" size="small" border>
          <el-table-column prop="nayinThickness" label="纳音(mm)" width="90" />
          <el-table-column prop="longchiThickness" label="龙池(mm)" width="90" />
          <el-table-column prop="fengzhaoThickness" label="凤沼(mm)" width="90" />
          <el-table-column prop="chamberDepth" label="槽深(mm)" width="90" />
          <el-table-column prop="postPos" label="天地柱" width="100" />
          <el-table-column prop="poolSize" label="池沼尺寸" width="110" />
          <el-table-column label="掏膛日期" width="100">
            <template #default="scope">{{ formatDate(scope.row.carvedAt) }}</template>
          </el-table-column>
          <el-table-column prop="carver" label="掏膛人" width="90" />
        </el-table>

        <h4>灰胎髹漆（{{ view.layers.length }} 遍，累计 {{ view.total.toFixed(2) }}mm）</h4>
        <LayerStack v-if="view.layers.length" :layers="view.layers" />
        <el-table v-if="view.layers.length" :data="view.layers" size="small" border class="mt8">
          <el-table-column prop="seq" label="遍次" width="60" />
          <el-table-column prop="mixRatio" label="配比" width="90" />
          <el-table-column label="温湿度" width="120">
            <template #default="scope">{{ scope.row.curingTemp }}℃ / {{ scope.row.curingHumidity }}%</template>
          </el-table-column>
          <el-table-column prop="polishGrit" label="目数" width="80" />
          <el-table-column prop="layerThickness" label="本遍(mm)" width="90" />
          <el-table-column prop="totalThickness" label="累计(mm)" width="90" />
          <el-table-column label="施工" width="100">
            <template #default="scope">{{ formatDate(scope.row.appliedAt) }}</template>
          </el-table-column>
          <el-table-column prop="operator" label="髹漆人" min-width="80" />
        </el-table>

        <h4>上弦与音色评价（{{ view.stringings.length }}）</h4>
        <el-table :data="view.stringings" size="small" border>
          <el-table-column prop="stringType" label="弦" width="70" />
          <el-table-column prop="nut" label="雁足绒扣" min-width="140" show-overflow-tooltip />
          <el-table-column prop="stringGap" label="弦距" width="70" />
          <el-table-column prop="sanNote" label="散音" min-width="140" show-overflow-tooltip />
          <el-table-column prop="anNote" label="按音" min-width="140" show-overflow-tooltip />
          <el-table-column prop="fanNote" label="泛音" min-width="140" show-overflow-tooltip />
          <el-table-column prop="nineVirtues" label="九德" min-width="140" show-overflow-tooltip />
          <el-table-column label="缺陷" width="90">
            <template #default="scope">{{ scope.row.defects.join('/') }}</template>
          </el-table-column>
        </el-table>
      </div>
    </el-drawer>
  </div>
</template>

<style scoped>
.page-title {
  margin: 0 0 4px;
  font-size: 20px;
  color: #4a3728;
}
.page-desc {
  margin: 0 0 14px;
  color: #8a7a68;
  font-size: 13px;
}
.stat-row {
  margin-bottom: 12px;
}
.stat-row .el-col {
  margin-bottom: 12px;
}
.toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}
.hint {
  font-size: 12px;
  color: #a3968a;
}
.block {
  margin-bottom: 14px;
  border-radius: 8px;
}
.card-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.guqin-no {
  font-weight: 600;
  color: #4a3728;
}
.open-line {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.meta {
  font-size: 12px;
  color: #8a7a68;
}
.view-body h4 {
  margin: 16px 0 8px;
  color: #4a3728;
}
.readonly-alert {
  margin-bottom: 4px;
}
.pair-note {
  font-size: 12px;
  color: #8a7a68;
  margin: 6px 0 0;
}
.mt8 {
  margin-top: 8px;
}
</style>
