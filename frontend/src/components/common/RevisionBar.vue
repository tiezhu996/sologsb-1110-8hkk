<script setup lang="ts">
import { computed, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { Lock, DocumentCopy } from '@element-plus/icons-vue';
import { useRevisionStore } from '../../stores/revisionStore';
import { useBoardStore } from '../../stores/boardStore';
import { useChamberStore } from '../../stores/chamberStore';
import { useLacquerStore } from '../../stores/lacquerStore';
import { useStringingStore } from '../../stores/stringingStore';
import { formatDate } from '../../utils/layer';

const revisionStore = useRevisionStore();
const boardStore = useBoardStore();
const chamberStore = useChamberStore();
const lacquerStore = useLacquerStore();
const stringingStore = useStringingStore();

const sealDialogVisible = ref(false);
const sealing = ref(false);
const sealNote = ref('');
const sealedBy = ref('');

const isDraft = computed(() => revisionStore.isViewingDraft);
const viewing = computed(() => revisionStore.viewing);

/** 封存后四类记录复制进了新修订，需要重新装载四个业务 store */
async function rehydrateRecords() {
  await Promise.all([boardStore.hydrate(), chamberStore.hydrate(), lacquerStore.hydrate(), stringingStore.hydrate()]);
}

function openSealDialog() {
  sealNote.value = '';
  sealedBy.value = '';
  sealDialogVisible.value = true;
}

async function confirmSeal() {
  if (sealing.value) return;
  sealing.value = true;
  try {
    const draftLabel = revisionStore.viewing?.label ?? '';
    const next = await revisionStore.sealCurrent({ note: sealNote.value, sealedBy: sealedBy.value });
    await rehydrateRecords();
    ElMessage.success(`已封存 ${draftLabel}（只读历史），新工作台 ${next.label} 已开好，可继续施工`);
    sealDialogVisible.value = false;
  } catch (error) {
    ElMessage.error(`封存失败，工作台未改动：${(error as Error).message}`);
  } finally {
    sealing.value = false;
  }
}

function backToDraft() {
  const draft = revisionStore.currentDraft;
  if (draft) revisionStore.setViewing(draft.id);
}
</script>

<template>
  <div class="revision-bar">
    <div class="rev-left">
      <span class="rev-caption">当前修订</span>
      <el-select
        :model-value="revisionStore.viewingId"
        size="small"
        style="width: 230px"
        @update:model-value="revisionStore.setViewing($event)"
      >
        <el-option
          v-for="rev in revisionStore.ordered"
          :key="rev.id"
          :value="rev.id"
          :label="`${rev.label} · ${rev.status === 'draft' ? '工作台' : `封存 ${rev.sealedAt ? formatDate(rev.sealedAt) : ''}`}`"
        >
          <span>{{ rev.label }}</span>
          <el-tag :type="rev.status === 'draft' ? 'warning' : 'info'" size="small" effect="plain" class="rev-option-tag">
            {{ rev.status === 'draft' ? '工作台' : '封存只读' }}
          </el-tag>
        </el-option>
      </el-select>
      <el-tag v-if="isDraft" type="warning" size="small" effect="dark">工作台 · 可施工</el-tag>
      <el-tag v-else type="info" size="small" effect="plain">
        <el-icon class="lock-icon"><Lock /></el-icon>封存快照 · 只读
      </el-tag>
      <span v-if="viewing?.sealedAt" class="rev-meta">封存于 {{ formatDate(viewing.sealedAt) }}<template v-if="viewing.sealedBy"> · {{ viewing.sealedBy }}</template></span>
      <span v-if="viewing?.note" class="rev-note">“{{ viewing.note }}”</span>
    </div>
    <div class="rev-right">
      <el-button v-if="!isDraft" size="small" @click="backToDraft">回到当前工作台</el-button>
      <el-button
        v-if="isDraft"
        size="small"
        type="primary"
        plain
        :icon="Lock"
        @click="openSealDialog"
      >
        封存并开新修订
      </el-button>
      <el-tooltip content="封存后当前四类记录冻结为只读修订，新工作台自动复制一份继续施工" placement="bottom">
        <el-icon class="rev-help"><DocumentCopy /></el-icon>
      </el-tooltip>
    </div>

    <el-dialog v-model="sealDialogVisible" title="封存当前工作台并开新修订" width="480px">
      <el-alert type="info" :closable="false" show-icon class="seal-tip">
        <template #title>
          封存 {{ viewing?.label }} 后，板材 / 槽腹 / 髹漆 / 上弦四类记录冻结为只读快照；
          系统会自动开出下一修订工作台并复制全部记录，旧验收结果保留在历史修订中可随时查看。
        </template>
      </el-alert>
      <el-form label-width="80px" class="seal-form">
        <el-form-item label="封存人">
          <el-input v-model="sealedBy" placeholder="如：周砚秋（选填）" maxlength="16" />
        </el-form-item>
        <el-form-item label="封存说明">
          <el-input v-model="sealNote" type="textarea" :rows="2" maxlength="80" show-word-limit placeholder="如：灰胎完工验收，待下一修订上弦" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="sealDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="sealing" @click="confirmSeal">确认封存并开新修订</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.revision-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  padding: 6px 12px;
  background: #f3ead9;
  border-bottom: 1px solid #e3d3b8;
  font-size: 12px;
}
.rev-left {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.rev-caption {
  color: #6b5840;
  font-weight: 600;
}
.rev-option-tag {
  margin-left: 8px;
}
.rev-meta {
  color: #8a7a68;
}
.rev-note {
  color: #9a7f3d;
}
.lock-icon {
  vertical-align: -2px;
  margin-right: 2px;
}
.rev-right {
  display: flex;
  align-items: center;
  gap: 8px;
}
.rev-help {
  color: #a99268;
  cursor: help;
}
.seal-tip {
  margin-bottom: 12px;
}
.seal-form {
  margin-top: 4px;
}
</style>
