<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { ElMessage } from 'element-plus';
import { Download } from '@element-plus/icons-vue';
import { seedIfEmpty } from './utils/seed';
import { downloadText, exportBackupJson } from './utils/export';
import { useBoardStore } from './stores/boardStore';
import { useChamberStore } from './stores/chamberStore';
import { useLacquerStore } from './stores/lacquerStore';
import { useStringingStore } from './stores/stringingStore';
import { useRevisionStore } from './stores/revisionStore';
import { revLabel } from './types/revision';

const route = useRoute();
const boardStore = useBoardStore();
const chamberStore = useChamberStore();
const lacquerStore = useLacquerStore();
const stringingStore = useStringingStore();
const revisionStore = useRevisionStore();
const ready = ref(false);

/** 顶栏备份提示用：每张琴当前开放修订标签 */
const currentRevisionText = computed(() => {
  const open = revisionStore.revisions.filter((r) => r.status === 'open');
  if (!open.length) return '当前无开放修订';
  return `当前修订：${open
    .slice(0, 3)
    .map((r) => `${r.guqinNo} ${revLabel(r.revNo)}`)
    .join('、')}${open.length > 3 ? ` 等 ${open.length} 张琴` : ''}`;
});

onMounted(async () => {
  try {
    await seedIfEmpty();
    // 修订档案是四类工作台记录的归属依据，先装载
    await revisionStore.hydrate();
    await Promise.all([boardStore.hydrate(), chamberStore.hydrate(), lacquerStore.hydrate(), stringingStore.hydrate()]);
  } catch (error) {
    ElMessage.error(`本地数据装载失败：${(error as Error).message}`);
  } finally {
    ready.value = true;
  }
});

async function handleExport() {
  const json = await exportBackupJson();
  downloadText(`gbguqin-backup-${new Date().toISOString().slice(0, 10)}.json`, json);
  const openCount = revisionStore.revisions.filter((r) => r.status === 'open').length;
  const sealedCount = revisionStore.sealedCount;
  ElMessage.success(`已导出全量备份（${openCount} 个当前修订、${sealedCount} 个封存修订，均标明当前修订）`);
}
</script>

<template>
  <el-container class="app-shell">
    <el-aside width="208px" class="app-aside">
      <div class="brand">
        <div class="brand-title">古琴斫制工序记录台</div>
        <div class="brand-sub">gbguqin · 纯前端本地存储</div>
      </div>
      <el-menu :default-active="route.path" router class="app-menu" background-color="#4a3728" text-color="#f0e6d8" active-text-color="#ffd591">
        <el-menu-item index="/">琴坯进度</el-menu-item>
        <el-menu-item index="/boards">板材登记</el-menu-item>
        <el-menu-item index="/chambers">槽腹尺寸</el-menu-item>
        <el-menu-item index="/lacquer">灰胎髹漆</el-menu-item>
        <el-menu-item index="/stringing">上弦评价</el-menu-item>
        <el-menu-item index="/revisions">修订档案</el-menu-item>
      </el-menu>
    </el-aside>
    <el-container>
      <el-header class="app-header">
        <div class="header-left">
          <span class="header-title">{{ (route.meta?.title as string) ?? '古琴斫制工序记录台' }}</span>
          <el-tooltip :content="currentRevisionText" placement="bottom">
            <el-tag size="small" type="warning" effect="plain" class="rev-tag">工作台 · 当前修订</el-tag>
          </el-tooltip>
        </div>
        <el-tooltip content="备份包含封存修订档案与每张琴当前修订标记" placement="bottom">
          <el-button :icon="Download" @click="handleExport">导出备份</el-button>
        </el-tooltip>
      </el-header>
      <el-main v-loading="!ready" element-loading-text="正在装载本地工序档案…" class="app-main">
        <router-view />
      </el-main>
      <el-footer class="app-footer">数据保存在浏览器 IndexedDB（gbguqin-db）：工作台 / 封存修订两套所有权，不依赖后端服务</el-footer>
    </el-container>
  </el-container>
</template>

<style scoped>
.app-shell {
  min-height: 100vh;
}
.app-aside {
  background: #4a3728;
  color: #f0e6d8;
}
.brand {
  padding: 16px 16px 8px;
}
.brand-title {
  font-size: 15px;
  font-weight: 600;
}
.brand-sub {
  font-size: 12px;
  color: #cbb79f;
}
.app-menu {
  border-right: none;
}
.app-header {
  background: #fff;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid #ece0cf;
}
.header-left {
  display: flex;
  align-items: center;
  gap: 10px;
}
.header-title {
  font-weight: 600;
  color: #4a3728;
}
.rev-tag {
  cursor: default;
}
.app-main {
  background: #f7f3ed;
  min-height: 60vh;
}
.app-footer {
  text-align: center;
  color: #a3968a;
  font-size: 12px;
  line-height: 48px;
}
</style>
