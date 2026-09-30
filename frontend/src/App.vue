<script setup lang="ts">
import { onMounted, ref } from 'vue';
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
import RevisionBar from './components/common/RevisionBar.vue';

const route = useRoute();
const boardStore = useBoardStore();
const chamberStore = useChamberStore();
const lacquerStore = useLacquerStore();
const stringingStore = useStringingStore();
const revisionStore = useRevisionStore();
const ready = ref(false);

onMounted(async () => {
  try {
    // 先自洽修订所有权（升级库已有初版 R001；异常半套库会就地修复），
    // 再播种全新库、最后装载四类记录；任一步失败都会留下错误信息而非半套界面。
    await revisionStore.bootstrap();
    const seededRevisionId = await seedIfEmpty();
    if (seededRevisionId) {
      await revisionStore.hydrate();
    }
    await Promise.all([boardStore.hydrate(), chamberStore.hydrate(), lacquerStore.hydrate(), stringingStore.hydrate()]);
  } catch (error) {
    ElMessage.error(`本地数据装载失败：${(error as Error).message}`);
  } finally {
    ready.value = true;
  }
});

async function handleExport() {
  const json = await exportBackupJson();
  const label = revisionStore.viewing?.label ?? 'all';
  downloadText(`gbguqin-backup-${label}-${new Date().toISOString().slice(0, 10)}.json`, json);
  ElMessage.success(`已导出当前修订 ${label} 在内的全量 JSON 备份`);
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
      </el-menu>
    </el-aside>
    <el-container>
      <el-header class="app-header">
        <span class="header-title">{{ (route.meta?.title as string) ?? '古琴斫制工序记录台' }}</span>
        <el-button :icon="Download" @click="handleExport">导出备份</el-button>
      </el-header>
      <RevisionBar />
      <el-main v-loading="!ready" element-loading-text="正在装载本地工序档案…" class="app-main">
        <router-view />
      </el-main>
      <el-footer class="app-footer">
        数据保存在浏览器 IndexedDB（gbguqin-db）；工作台可继续施工，封存修订只读，历史修订可随时查看
      </el-footer>
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
  height: 56px;
}
.header-title {
  font-weight: 600;
  color: #4a3728;
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
