<script setup lang="ts">
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import StatBadge from '../components/common/StatBadge.vue';
import ProcessTimeline from '../components/common/ProcessTimeline.vue';
import FilterBar from '../components/common/FilterBar.vue';
import { useStageProgress, STAGE_LABELS, type StageKey } from '../hooks/useStageProgress';
import { useBoardStore } from '../stores/boardStore';
import { useChamberStore } from '../stores/chamberStore';
import { useLacquerStore } from '../stores/lacquerStore';
import { useStringingStore } from '../stores/stringingStore';
import { useRevisionStore } from '../stores/revisionStore';
import { formatDate } from '../utils/layer';
import { WOOD_SPECIES } from '../types/wood-board';
import type { TimelineEvent } from '../types/ui';

const route = useRoute();
const router = useRouter();
const boardStore = useBoardStore();
const chamberStore = useChamberStore();
const lacquerStore = useLacquerStore();
const stringingStore = useStringingStore();
const revisionStore = useRevisionStore();
const { progressList, summary } = useStageProgress();

const stageParam = computed(() => (typeof route.query.stage === 'string' ? route.query.stage : ''));
const speciesParam = computed(() => (typeof route.query.species === 'string' ? route.query.species : ''));

const visible = computed(() =>
  progressList.value.filter((item) => {
    if (speciesParam.value && item.species !== speciesParam.value) return false;
    if (stageParam.value) {
      const stage = item.stages.find((s) => s.label === stageParam.value);
      if (!stage || !stage.done) return false;
    }
    return true;
  }),
);

const stageBadges = computed(() =>
  (Object.keys(STAGE_LABELS) as StageKey[]).map((key) => ({
    key,
    label: STAGE_LABELS[key],
    count: summary.value.counts[key],
  })),
);

const pendingString = computed(() => progressList.value.filter((item) => !item.stages.find((s) => s.key === 'string')?.done).length);
const sealedTotal = computed(() => revisionStore.sealedCount);

function openRevisions() {
  void router.push('/revisions');
}

const events = computed<TimelineEvent[]>(() => {
  const list: TimelineEvent[] = [];
  chamberStore.chambers.forEach((chamber) => {
    list.push({
      label: `掏膛完成 · ${chamber.guqinNo}`,
      at: formatDate(chamber.carvedAt),
      text: `槽腹深度 ${chamber.chamberDepth}mm，纳音 ${chamber.nayinThickness}mm，天地柱 ${chamber.postPos}，掏膛人 ${chamber.carver}`,
      type: 'primary',
    });
  });
  lacquerStore.layers.forEach((layer) => {
    list.push({
      label: `髹漆第 ${layer.seq} 遍 · ${layer.guqinNo}`,
      at: formatDate(layer.appliedAt),
      text: `配比 ${layer.mixRatio}，本遍 ${layer.layerThickness}mm，累计 ${layer.totalThickness}mm，荫房 ${layer.curingTemp}℃ / ${layer.curingHumidity}%，${layer.polishGrit} 目`,
      type: 'warning',
    });
  });
  stringingStore.stringings.forEach((stringing) => {
    list.push({
      label: `上弦 · ${stringing.guqinNo}`,
      at: formatDate(stringing.strungAt),
      text: `${stringing.stringType}，弦距 ${stringing.stringGap}mm，缺陷 ${stringing.defects.join('/')}，九德：${stringing.nineVirtues}`,
      type: 'success',
    });
  });
  return list.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 8);
});
</script>

<template>
  <div>
    <h2 class="page-title">琴坯进度</h2>
    <p class="page-desc">
      按选材 / 掏膛 / 灰胎 / 上弦四阶段统计在制琴坯；进度、累计灰胎均取每张琴<span class="hl">当前开放修订</span>的工作台数据，历史封存修订在「修订档案」只读查看。
    </p>

    <el-row :gutter="12" class="stat-row">
      <el-col :xs="12" :md="6">
        <StatBadge label="在制琴坯" :value="progressList.length" unit="张" />
      </el-col>
      <el-col :xs="12" :md="6">
        <StatBadge label="四阶段完成" :value="summary.completed" unit="张" status="success" />
      </el-col>
      <el-col :xs="12" :md="6">
        <StatBadge label="平均推进比" :value="summary.averageRatio" unit="%" status="warning" />
      </el-col>
      <el-col :xs="12" :md="6">
        <StatBadge label="待上弦" :value="pendingString" unit="张" :status="pendingString ? 'danger' : 'success'" />
      </el-col>
      <el-col :xs="12" :md="6">
        <StatBadge label="已封存修订" :value="sealedTotal" unit="个" status="success" />
      </el-col>
    </el-row>

    <el-card shadow="never" class="block">
      <template #header>
        <div class="card-head">
          <span>阶段统计（已完成琴坯数）</span>
          <span class="card-note">
            板材 {{ boardStore.boards.length }} 块（可用 {{ boardStore.usableCount }} 块）· 髹漆 {{ lacquerStore.layers.length }} 遍 ·
            荫房异常 {{ lacquerStore.outOfRangeCount }} 遍 ·
            <el-button link type="primary" @click="openRevisions">封存修订 {{ sealedTotal }} 个，查看档案 ›</el-button>
          </span>
        </div>
      </template>
      <el-row :gutter="12">
        <el-col v-for="badge in stageBadges" :key="badge.key" :xs="12" :md="6">
          <StatBadge :label="`${badge.label} 完成`" :value="badge.count" unit="张" />
        </el-col>
      </el-row>
    </el-card>

    <el-card shadow="never" class="block">
      <template #header>
        <div class="card-head">
          <span>琴坯阶段明细</span>
          <span class="card-note">缺项会在「缺失项」列标出</span>
        </div>
      </template>
      <FilterBar
        :fields="[
          { key: 'stage', label: '工序阶段', options: ['选材', '掏膛', '灰胎', '上弦'], width: 120 },
          { key: 'species', label: '树种', options: WOOD_SPECIES, width: 110 },
        ]"
        keyword-placeholder="搜索琴号（本页按阶段/树种筛选）"
        :result-count="visible.length"
        :total-count="progressList.length"
      />
      <el-table :data="visible" size="small" border>
        <el-table-column prop="guqinNo" label="琴号" width="100" />
        <el-table-column label="当前修订" width="150">
          <template #default="scope">
            <el-tag type="warning" size="small" effect="plain">{{ scope.row.revisionLabel }}</el-tag>
            <el-tag v-if="scope.row.sealedCount" type="success" size="small" effect="plain" class="sealed-tag">
              存 {{ scope.row.sealedCount }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="species" label="树种" width="80" />
        <el-table-column label="四阶段" min-width="300">
          <template #default="scope">
            <el-tag
              v-for="stage in scope.row.stages"
              :key="stage.key"
              class="stage-tag"
              :type="stage.done ? 'success' : 'info'"
              effect="plain"
            >
              {{ stage.label }}{{ stage.done ? '✓' : '…' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="推进比" width="180">
          <template #default="scope">
            <el-progress :percentage="scope.row.ratio" :status="scope.row.ratio === 100 ? 'success' : undefined" />
          </template>
        </el-table-column>
        <el-table-column label="缺失项" min-width="160">
          <template #default="scope">
            <span v-if="scope.row.missing.length" class="missing">{{ scope.row.missing.join('、') }}</span>
            <el-tag v-else type="success" size="small">齐备</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="累计灰胎(mm)" width="140">
          <template #default="scope">
            <span>{{ scope.row.cumulativeMm.toFixed(2) }}</span>
            <span class="cur-hint">·{{ scope.row.revisionLabel }}</span>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-card shadow="never" class="block">
      <template #header>最近工序动态</template>
      <ProcessTimeline :events="events" />
    </el-card>
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
.block {
  margin-bottom: 16px;
  border-radius: 8px;
}
.card-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.card-note {
  font-size: 12px;
  color: #8a7a68;
}
.stage-tag {
  margin-right: 6px;
}
.missing {
  color: #c62828;
  font-size: 13px;
}
.hl {
  color: #b7791f;
  font-weight: 600;
}
.sealed-tag {
  margin-left: 4px;
}
.cur-hint {
  font-size: 11px;
  color: #b7791f;
  margin-left: 2px;
}
</style>
