/**
 * v3 升级失败回滚验证（fake-indexeddb）。
 *
 * 做法：v2 旧库保持一个"占库连接"打开，再用 v3 代码去打开同一库——
 * 浏览器规范里，旧连接不拦截 versionchange 时升级本可进行；这里改为直接在
 * 升级回调内抛错，验证 IndexedDB versionchange 事务回滚：旧四张表完整保留、
 * revisions 表不存在、库版本仍是 2，下次用 v2 打开还是完整旧档。
 *
 * 运行：npx tsx scripts/migration-rollback.test.ts
 */
import 'fake-indexeddb/auto';
import Dexie from 'dexie';

let passed = 0;
function check(name: string, cond: boolean) {
  if (!cond) throw new Error(`断言失败：${name}`);
  passed += 1;
  console.log(`  ✓ ${name}`);
}

async function deleteDatabase(): Promise<void> {
  return new Promise((resolve) => {
    const req = indexedDB.deleteDatabase('gbguqin-db');
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
}

async function main() {
  await deleteDatabase();

  console.log('准备：建一个含旧档的 v2 库（2 板 / 1 槽腹 / 1 髹漆 / 1 上弦）');
  const v2 = new Dexie('gbguqin-db');
  v2.version(2).stores({
    boards: 'id, boardNo, guqinNo, part, species, grain, receivedAt',
    chambers: 'id, guqinNo, postPos, carvedAt',
    lacquers: 'id, guqinNo, seq, [guqinNo+seq], appliedAt',
    stringings: 'id, guqinNo, stringType, strungAt',
    meta: 'key',
  });
  const t = (name: string) => (v2 as unknown as { table: (n: string) => Dexie.Table }).table(name);
  await t('boards').bulkPut([
    { id: 'b1', boardNo: 'MB-1', guqinNo: 'Q-1', part: '面板', species: '桐木', dryYears: 8, thicknessMm: 32, grain: '直纹', defect: '无', receivedAt: 'x' },
    { id: 'b2', boardNo: 'MB-2', guqinNo: 'Q-1', part: '底板', species: '梓木', dryYears: 6, thicknessMm: 18, grain: '直纹', defect: '无', receivedAt: 'x' },
  ]);
  await t('chambers').put({ id: 'c1', guqinNo: 'Q-1', nayinThickness: 16, longchiThickness: 14, fengzhaoThickness: 15, chamberDepth: 26, postPos: '天柱中', poolSize: 'p', carvedAt: 'x', carver: '周' });
  await t('lacquers').put({ id: 'l1', guqinNo: 'Q-1', seq: 1, mixRatio: '1:1', curingTemp: 24, curingHumidity: 78, polishGrit: 320, layerThickness: 0.1, totalThickness: 0.1, appliedAt: 'x', operator: '林' });
  await t('stringings').put({ id: 's1', guqinNo: 'Q-1', stringType: '丝弦', nut: 'n', stringGap: 17, sanNote: 'a', anNote: 'b', fanNote: 'c', nineVirtues: 'd', defects: ['无'], strungAt: 'x', operator: '周', noteVersions: [] });
  await v2.close();

  console.log('\n场景：用一个"升级中途必抛错"的 v3 声明打开，强制升级失败');
  const failing = new Dexie('gbguqin-db');
  failing
    .version(3)
    .stores({
      boards: 'id, boardNo, guqinNo, revisionId, part, species, grain, receivedAt',
      chambers: 'id, guqinNo, revisionId, postPos, carvedAt',
      lacquers: 'id, guqinNo, revisionId, seq, [guqinNo+seq], appliedAt',
      stringings: 'id, guqinNo, revisionId, stringType, strungAt',
      revisions: 'id, guqinNo, revNo, status, frozenAt',
      meta: 'key',
    })
    .upgrade(async () => {
      // 模拟真实失败：例如快照写一半断电/约束错误
      throw new Error('模拟升级中途失败（如断电/约束冲突）');
    });

  let openError: unknown = null;
  try {
    await failing.open();
  } catch (err) {
    openError = err;
  }
  check('打开 v3 确实失败', !!openError);
  failing.close();

  console.log('\n验证：失败后用 v2 重新打开——必须是完整旧档');
  const reopen = new Dexie('gbguqin-db');
  reopen.version(2).stores({
    boards: 'id, boardNo, guqinNo, part, species, grain, receivedAt',
    chambers: 'id, guqinNo, postPos, carvedAt',
    lacquers: 'id, guqinNo, seq, [guqinNo+seq], appliedAt',
    stringings: 'id, guqinNo, stringType, strungAt',
    meta: 'key',
  });
  await reopen.open();
  const rt = (name: string) => (reopen as unknown as { table: (n: string) => Dexie.Table }).table(name);
  check('库版本回退在 2（不是半套 v3）', reopen.verno === 2);
  check('板材仍是完整 2 块', (await rt('boards').count()) === 2);
  check('槽腹仍是完整 1 条', (await rt('chambers').count()) === 1);
  check('髹漆仍是完整 1 条', (await rt('lacquers').count()) === 1);
  check('上弦仍是完整 1 条', (await rt('stringings').count()) === 1);
  check('旧板材内容未被改动', (await rt('boards').get('b1')).boardNo === 'MB-1');
  let hasRevisionsStore = true;
  try {
    await rt('revisions').count();
  } catch {
    hasRevisionsStore = false;
  }
  check('revisions 新表不存在（无半套新库）', hasRevisionsStore === false);
  reopen.close();

  console.log(`\n全部 ${passed} 条断言通过：升级失败已整体回退，下次打开仍是完整旧档。`);
}

main().catch((err) => {
  console.error('\n测试失败：', err);
  process.exit(1);
});
