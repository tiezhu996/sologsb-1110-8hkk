import { ElMessage, ElMessageBox } from 'element-plus';
import { useRevisionStore } from '../stores/revisionStore';
import { useBoardStore } from '../stores/boardStore';
import { useChamberStore } from '../stores/chamberStore';
import { useLacquerStore } from '../stores/lacquerStore';
import { useStringingStore } from '../stores/stringingStore';
import { revLabel } from '../types/revision';

export interface FreezeResult {
  sealedRevNo: number;
  nextRevNo: number;
}

/** 封存确认框 → 生成只读修订、自动续开下一版 → 全部 store 重新装载 */
export async function freezeRevision(guqinNo: string): Promise<FreezeResult | null> {
  const revisionStore = useRevisionStore();
  const open = revisionStore.openByGuqin(guqinNo);
  if (!open) {
    ElMessage.warning(`${guqinNo} 没有开放中的修订`);
    return null;
  }

  const { value: note } = await ElMessageBox.prompt(
    `封存 ${guqinNo} 的${revLabel(open.revNo)}：板材、槽腹、髹漆、上弦四类记录将冻结为只读修订，并自动续开${revLabel(
      open.revNo + 1,
    )}继续施工。可填写本次封存说明：`,
    '封存当前修订',
    {
      confirmButtonText: '封存并续开',
      cancelButtonText: '取消',
      inputPlaceholder: '如：灰胎完工验收 / 成琴验收',
      inputValue: '',
      type: 'warning',
    },
  ).catch(() => ({ value: undefined }));
  if (note === undefined) return null;

  try {
    const { sealed, openNext } = await revisionStore.freeze(guqinNo, note || undefined);
    // 封存改动了四张工作台表，统一重新装载，避免页面残留旧归属
    const boardStore = useBoardStore();
    const chamberStore = useChamberStore();
    const lacquerStore = useLacquerStore();
    const stringingStore = useStringingStore();
    await Promise.all([
      boardStore.hydrate(),
      chamberStore.hydrate(),
      lacquerStore.hydrate(),
      stringingStore.hydrate(),
    ]);
    ElMessage.success(`${guqinNo} 已封存 ${revLabel(sealed.revNo)}（只读），工作台已续开 ${revLabel(openNext.revNo)}`);
    return { sealedRevNo: sealed.revNo, nextRevNo: openNext.revNo };
  } catch (error) {
    ElMessage.error(`封存失败，工作台维持原样：${(error as Error).message}`);
    return null;
  }
}
