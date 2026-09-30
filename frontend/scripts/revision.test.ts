/**
 * 修订所有权 + v2→v3 迁移的内存集成测试（fake-indexeddb，无浏览器）。
 * 运行：npx tsx scripts/revision.test.ts
 */
import 'fake-indexeddb/auto';
import { assert } from 'node:console';
import Dexie from 'dexie';

let passed = 0;
function check(name: string, cond: boolean) {
  if (!cond) throw new Error(`断言失败：${name}`);
  passed += 1;
  console.log(`  ✓ ${name}`);
}

function v2Row(table: string, row: Record<string, unknown>) {
  return { table, row };
}

/** 建一个真实的 v2 旧库并灌入旧档 */
async function buildV2Database() {
  const old = new Dexie('gbguqin-db');
  old.version(2).stores({
    boards: 'id, boardNo, guqinNo, part, species, grain, receivedAt',
    chambers: 'id, guqinNo, postPos, carvedAt',
    lacquers: 'id, guqinNo, seq, [guqinNo+seq], appliedAt',
    stringings: 'id, guqinNo, stringType, strungAt',
    meta: 'key',
  });
  await (old as unknown as { table: (t: string) => Dexie.Table }).table('boards').bulkPut([
    { id: 'b1', boardNo: 'MB-1', guqinNo: 'Q-1', part: '面板', species: '桐木', dryYears: 8, thicknessMm: 32, grain: '直纹', defect: '无', receivedAt: '2026-01-01' },
    { id: 'b2', boardNo: 'MB-2', guqinNo: 'Q-1', part: '底板', species: '梓木', dryYears: 6, thicknessMm: 18, grain: '直纹', defect: '无', receivedAt: '2026-01-02' },
  ]);
  await (old as unknown as { table: (t: string) => Dexie.Table }).table('chambers').bulkPut([
    { id: 'c1', guqinNo: 'Q-1', nayinThickness: 16, longchiThickness: 14, fengzhaoThickness: 15, chamberDepth: 26, postPos: '天柱中', poolSize: '200×22', carvedAt: '2026-02-01', carver: '周' },
  ]);
  await (old as unknown as { table: (t: string) => Dexie.Table }).table('lacquers').bulkPut([
    { id: 'l1', guqinNo: 'Q-1', seq: 1, mixRatio: '1:1', curingTemp: 24, curingHumidity: 78, polishGrit: 320, layerThickness: 0.1, totalThickness: 0.1, appliedAt: '2026-03-01', operator: '林' },
  ]);
  await (old as unknown as { table: (t: string) => Dexie.Table }).table('stringings').bulkPut([
    { id: 's1', guqinNo: 'Q-1', stringType: '丝弦', nut: '红木', stringGap: 17, sanNote: 'a', anNote: 'b', fanNote: 'c', nineVirtues: 'd', defects: ['无'], strungAt: '2026-04-01', operator: '周', noteVersions: [] },
  ]);
  await (old as unknown as { table: (t: string) => Dexie.Table }).table('meta').put({ key: 'seeded', value: '2026-01-01' });
  await old.close();
  void v2Row;
}

/** 删除当前内存库，模拟下次打开（Dexie 单例缓存要重置） */
function deleteDatabase(): Promise<void> {
  return new Promise((resolve) => {
    const req = indexedDB.deleteDatabase('gbguqin-db');
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
}

async function main() {
  console.log('场景 1：v2 旧档升级 → 初版封存 + 第 2 版工作台');
  await deleteDatabase();
  await buildV2Database();

  const { db } = await import('../src/utils/db');
  check('库版本为 3', db.verno === 3);

  const revisions = await db.revisions.toArray();
  check('生成 2 个修订（初版 sealed + 第 2 版 open）', revisions.length === 2);
  const sealed = revisions.find((r) => r.status === 'sealed')!;
  const open = revisions.find((r) => r.status === 'open')!;
  check('封存为初版', sealed.revNo === 1);
  check('续开为第 2 版', open.revNo === 2);
  check('open.sourceRevisionId 指向封存', open.sourceRevisionId === sealed.id);
  check('封存快照四类齐全 2/1/1/1', sealed.counts.boards === 2 && sealed.counts.chambers === 1 && sealed.counts.lacquers === 1 && sealed.counts.stringings === 1);
  check('封存快照保留旧业务字段', sealed.boards[0].boardNo === 'MB-1' && sealed.stringings[0].noteVersions.length === 0);

  const wbBoards = await db.boards.toArray();
  check('工作台板材仍有 2 块（复制成新 id 续开）', wbBoards.length === 2);
  check('工作台行归属第 2 版', wbBoards.every((b) => b.revisionId === open.id));
  check('工作台行是新 id，与封存快照不同 id', wbBoards.every((b) => b.id.endsWith('~open')) && !sealed.boards.some((sb) => sb.id === wbBoards[0].id));
  check('工作台行保留全部业务字段', wbBoards[0].thicknessMm === 32 && wbBoards[0].boardNo === 'MB-1');
  const wbLacquer = await db.lacquers.toArray();
  check('工作台髹漆累计厚度等字段保留', wbLacquer[0].totalThickness === 0.1 && wbLacquer[0].seq === 1);

  console.log('\n场景 2：封存当前开放修订 → 只读快照 + 自动续开第 3 版');
  const { useRevisionStore: useRev } = await import('../src/stores/revisionStore');
  const { __setFreezeFailureHookForTest } = await import('../src/stores/revisionStore');
  const { setActivePinia, createPinia } = await import('pinia');
  setActivePinia(createPinia());
  const revStore = useRev();
  await revStore.hydrate();

  const result = await revStore.freeze('Q-1', '灰胎验收');
  check('封存返回第 2 版', result.sealed.revNo === 2);
  check('续开第 3 版', result.openNext.revNo === 3);
  check('封存条数 2/1/1/1', result.counts.boards === 2 && result.counts.stringings === 1);

  const afterRevs = await db.revisions.toArray();
  check('修订总数变为 3（初版+第2版封存+第3版开放）', afterRevs.length === 3);
  check('第 2 版已 sealed', afterRevs.find((r) => r.revNo === 2)!.status === 'sealed');
  const open3 = afterRevs.find((r) => r.revNo === 3)!;
  check('第 3 版为 open 且来源第 2 版', open3.status === 'open' && open3.sourceRevisionId === result.sealed.id);

  const wb3 = await db.boards.toArray();
  check('封存后工作台仍有 2 块（复制续开到第 3 版）', wb3.length === 2);
  check('工作台行已归属第 3 版', wb3.every((b) => b.revisionId === open3.id));
  check('续开行再次换新 id，旧工作台 id 已删除', wb3.every((b) => !b.id.endsWith('~open')));

  // 工作台继续施工改不影响任何封存快照
  const sealed2 = afterRevs.find((r) => r.revNo === 2)!;
  check('第 2 版封存快照与第 3 版工作台是不同对象/数据', sealed2.boards[0].id !== wb3[0].id);
  check('初版与第 2 版两份封存快照各自独立', sealed.boards[0].id !== sealed2.boards[0].id);

  console.log('\n场景 3：空修订封存抛错且不产生半套数据');
  // 造一张只有空开放修订的琴
  const empty = await revStore.ensureOpen('Q-EMPTY');
  let threw = false;
  try {
    await revStore.freeze('Q-EMPTY');
  } catch {
    threw = true;
  }
  check('空修订封存被拒绝', threw);
  const stillThere = await db.revisions.get(empty.id);
  check('被拒后开放修订原样保留', !!stillThere && stillThere.status === 'open');

  console.log('\n场景 4：封存事务中途失败 → 回滚，工作台与修订维持封存前');
  // 先准备一张有完整数据、处于某开放修订的琴
  await revStore.ensureOpen('Q-ROLL');
  await db.boards.put({ id: 'rb1', boardNo: 'MB-R1', guqinNo: 'Q-ROLL', part: '面板', species: '桐木', dryYears: 5, thicknessMm: 30, grain: '直纹', defect: '无', receivedAt: 'x', revisionId: revStore.openByGuqin('Q-ROLL')!.id });
  const beforeOpen = revStore.openByGuqin('Q-ROLL')!;
  const revCountBefore = (await db.revisions.toArray()).length;
  __setFreezeFailureHookForTest(() => {
    throw new Error('模拟封存写一半失败');
  });
  let freezeThrew = false;
  try {
    await revStore.freeze('Q-ROLL', '应回滚');
  } catch {
    freezeThrew = true;
  }
  __setFreezeFailureHookForTest(null);
  check('封存抛出失败', freezeThrew);
  check('修订数未增加（sealed/openNext 都回滚）', (await db.revisions.toArray()).length === revCountBefore);
  check('原开放修订仍是 open', (await db.revisions.get(beforeOpen.id))!.status === 'open');
  const rollBoards = await db.boards.where('guqinNo').equals('Q-ROLL').toArray();
  check('工作台板材仍是原 1 块、原 id、原归属', rollBoards.length === 1 && rollBoards[0].id === 'rb1' && rollBoards[0].revisionId === beforeOpen.id);

  console.log(`\n全部 ${passed} 条断言通过。`);
  db.close();
}

main().catch((err) => {
  console.error('\n测试失败：', err);
  process.exit(1);
});
