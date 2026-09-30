import { db } from './db';
import type { WoodBoard } from '../types/wood-board';
import type { SoundChamber } from '../types/sound-chamber';
import type { LacquerLayer } from '../types/lacquer-layer';
import type { Stringing } from '../types/stringing';
import type { Revision } from '../types/revision';
import { cumulativeThickness } from './layer';

const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY).toISOString();

/** 示例琴坯：5 张琴、10 块板材 */
export const SEED_BOARDS: WoodBoard[] = [
  { id: 'board-001', boardNo: 'MB-2501', guqinNo: 'Q-2501', part: '面板', species: '桐木', dryYears: 8, thicknessMm: 32, grain: '直纹', defect: '无', receivedAt: daysAgo(120), remark: '河南兰考桐' },
  { id: 'board-002', boardNo: 'MB-2502', guqinNo: 'Q-2501', part: '底板', species: '梓木', dryYears: 6, thicknessMm: 18, grain: '直纹', defect: '无', receivedAt: daysAgo(118) },
  { id: 'board-003', boardNo: 'MB-2503', guqinNo: 'Q-2502', part: '面板', species: '杉木', dryYears: 12, thicknessMm: 30, grain: '水波纹', defect: '无', receivedAt: daysAgo(110), remark: '川杉，纹路佳' },
  { id: 'board-004', boardNo: 'MB-2504', guqinNo: 'Q-2502', part: '底板', species: '梓木', dryYears: 7, thicknessMm: 17, grain: '直纹', defect: '节疤', receivedAt: daysAgo(108) },
  { id: 'board-005', boardNo: 'MB-2505', guqinNo: 'Q-2503', part: '面板', species: '桐木', dryYears: 5, thicknessMm: 31, grain: '直纹', defect: '无', receivedAt: daysAgo(96) },
  { id: 'board-006', boardNo: 'MB-2506', guqinNo: 'Q-2503', part: '底板', species: '杉木', dryYears: 5, thicknessMm: 18, grain: '直纹', defect: '无', receivedAt: daysAgo(95) },
  { id: 'board-007', boardNo: 'MB-2507', guqinNo: 'Q-2504', part: '面板', species: '杉木', dryYears: 15, thicknessMm: 33, grain: '水波纹', defect: '无', receivedAt: daysAgo(80), remark: '老房料' },
  { id: 'board-008', boardNo: 'MB-2508', guqinNo: 'Q-2504', part: '底板', species: '梓木', dryYears: 9, thicknessMm: 19, grain: '直纹', defect: '无', receivedAt: daysAgo(78) },
  { id: 'board-009', boardNo: 'MB-2509', guqinNo: 'Q-2505', part: '面板', species: '桐木', dryYears: 2, thicknessMm: 29, grain: '直纹', defect: '裂纹', receivedAt: daysAgo(30), remark: '阴干不足且有裂纹，待退料' },
  { id: 'board-010', boardNo: 'MB-2510', guqinNo: 'Q-2505', part: '底板', species: '梓木', dryYears: 4, thicknessMm: 17, grain: '直纹', defect: '无', receivedAt: daysAgo(28) },
];

export const SEED_CHAMBERS: SoundChamber[] = [
  { id: 'chamber-001', guqinNo: 'Q-2501', nayinThickness: 16, longchiThickness: 14, fengzhaoThickness: 15, chamberDepth: 26, postPos: '天柱中', poolSize: '200×22', carvedAt: daysAgo(88), carver: '周砚秋', remark: '纳音略厚，出音偏沉' },
  { id: 'chamber-002', guqinNo: 'Q-2502', nayinThickness: 14, longchiThickness: 12, fengzhaoThickness: 13, chamberDepth: 28, postPos: '天柱偏左', poolSize: '210×24', carvedAt: daysAgo(76), carver: '周砚秋' },
  { id: 'chamber-003', guqinNo: 'Q-2503', nayinThickness: 15, longchiThickness: 13, fengzhaoThickness: 14, chamberDepth: 25, postPos: '天柱偏右', poolSize: '195×21', carvedAt: daysAgo(60), carver: '林听雪' },
  { id: 'chamber-004', guqinNo: 'Q-2504', nayinThickness: 17, longchiThickness: 15, fengzhaoThickness: 16, chamberDepth: 24, postPos: '天柱中', poolSize: '215×25', carvedAt: daysAgo(44), carver: '林听雪', remark: '老料槽腹留厚' },
];

function buildSeedLayers(): LacquerLayer[] {
  const plan: Array<[string, string, number, number, number, number, number, string]> = [
    // guqinNo, mixRatio, temp, humidity, grit, thicknessMm, daysAgo, operator
    ['Q-2501', '1:1', 24, 78, 240, 0.12, 70, '林听雪'],
    ['Q-2501', '1:1', 25, 80, 320, 0.1, 58, '林听雪'],
    ['Q-2501', '1:1.2', 26, 82, 400, 0.09, 40, '林听雪'],
    ['Q-2502', '1:1', 23, 76, 240, 0.13, 62, '林听雪'],
    ['Q-2502', '1:1.5', 27, 84, 400, 0.11, 45, '周砚秋'],
    ['Q-2502', '1:1.5', 25, 80, 600, 0.08, 30, '周砚秋'],
    ['Q-2503', '1:1.2', 22, 74, 240, 0.12, 48, '林听雪'],
    ['Q-2503', '1:1.2', 26, 82, 400, 0.1, 33, '林听雪'],
    ['Q-2504', '1:1', 24, 79, 320, 0.12, 36, '周砚秋'],
    ['Q-2504', '1:1.5', 28, 85, 600, 0.09, 21, '周砚秋'],
    ['Q-2501', '1:2', 18, 65, 800, 0.05, 18, '林听雪'],
    ['Q-2502', '纯生漆', 24, 70, 1000, 0.04, 12, '周砚秋'],
  ];

  const seqMap = new Map<string, number>();
  return plan.map(([guqinNo, mixRatio, temp, humidity, grit, thickness, days, operator], index) => {
    const seq = (seqMap.get(guqinNo) ?? 0) + 1;
    seqMap.set(guqinNo, seq);
    return {
      id: `layer-${String(index + 1).padStart(3, '0')}`,
      guqinNo,
      seq,
      mixRatio,
      curingTemp: temp,
      curingHumidity: humidity,
      polishGrit: grit,
      layerThickness: thickness,
      totalThickness: 0,
      appliedAt: daysAgo(days),
      operator,
    };
  });
}

/** 重新计算每张琴的累计厚度（写入本地库前的派生值） */
export function withCumulative(layers: LacquerLayer[]): LacquerLayer[] {
  const byGuqin = new Map<string, LacquerLayer[]>();
  layers.forEach((layer) => {
    const list = byGuqin.get(layer.guqinNo) ?? [];
    list.push(layer);
    byGuqin.set(layer.guqinNo, list);
  });
  return layers.map((layer) => ({
    ...layer,
    totalThickness: cumulativeThickness(byGuqin.get(layer.guqinNo) ?? [], layer.seq),
  }));
}

export const SEED_STRINGINGS: Stringing[] = [
  {
    id: 'stringing-001',
    guqinNo: 'Q-2501',
    stringType: '丝弦',
    nut: '红木雁足 + 丝绒扣',
    stringGap: 17,
    sanNote: '散音宽厚，一弦如钟，七弦略紧需再养。',
    anNote: '按音走手顺滑，九徽以下音色沉静，无抗指。',
    fanNote: '泛音清亮，五六徽尤其干净。',
    nineVirtues: '奇、古、透、静、润佳；圆、匀稍欠，清、芳待养。',
    defects: ['无'],
    strungAt: daysAgo(10),
    operator: '周砚秋',
    noteVersions: [],
  },
  {
    id: 'stringing-002',
    guqinNo: 'Q-2502',
    stringType: '钢弦',
    nut: '乌木雁足 + 尼龙扣',
    stringGap: 18,
    sanNote: '散音亮而略噪，钢弦本性使然。',
    anNote: '按音清越，四弦七徽处有轻微沙音。',
    fanNote: '泛音通透，尤以三徽为最。',
    nineVirtues: '透、清、亮为主；古、静不足。',
    defects: ['沙音'],
    strungAt: daysAgo(6),
    operator: '林听雪',
    noteVersions: [],
  },
  {
    id: 'stringing-003',
    guqinNo: 'Q-2503',
    stringType: '丝弦',
    nut: '红木雁足 + 丝绒扣',
    stringGap: 17,
    sanNote: '散音均匀，五弦稍闷。',
    anNote: '按音圆润，走弦无声，宜弹文曲。',
    fanNote: '泛音圆而不散。',
    nineVirtues: '圆、润、匀见长；透、芳尚需时日。',
    defects: ['无'],
    strungAt: daysAgo(3),
    operator: '林听雪',
    noteVersions: [
      { id: 'tv-001', savedAt: daysAgo(3), sanNote: '散音初上，音色紧。', anNote: '按音略抗指。', fanNote: '泛音偏闷。', nineVirtues: '新弦未开。' },
    ],
  },
];

/**
 * 首次打开（表内无数据）时写入示例数据；已有数据则不动。
 *
 * v3 所有权：每张示例琴自带一个「初版」开放修订，四类行挂到对应 revisionId；
 * 全部写入跑在同一事务里，半套失败一起回滚。
 */
export async function seedIfEmpty(): Promise<void> {
  const flag = await db.meta.get('seeded');
  if (flag) {
    return;
  }
  const [boardCount, chamberCount, lacquerCount, stringingCount, revisionCount] = await Promise.all([
    db.boards.count(),
    db.chambers.count(),
    db.lacquers.count(),
    db.stringings.count(),
    db.revisions.count(),
  ]);
  if (boardCount || chamberCount || lacquerCount || stringingCount || revisionCount) {
    // 非空库（含刚由 v2 升级出修订档案）只补标记，绝不覆盖
    await db.meta.put({ key: 'seeded', value: new Date().toISOString() });
    return;
  }

  const layers = withCumulative(buildSeedLayers());
  const frozenAt = new Date().toISOString();
  const guqinNos = Array.from(
    new Set([
      ...SEED_BOARDS.map((b) => b.guqinNo),
      ...SEED_CHAMBERS.map((c) => c.guqinNo),
      ...layers.map((l) => l.guqinNo),
      ...SEED_STRINGINGS.map((s) => s.guqinNo),
    ]),
  ).sort();

  /** 琴号 → 初版开放修订 id（确定性 id，示例数据可重复构建） */
  const revByGuqin = new Map<string, string>();
  const seedRevisions: Revision[] = guqinNos.map((guqinNo) => {
    const id = `rev-seed-${guqinNo}`;
    revByGuqin.set(guqinNo, id);
    return {
      id,
      guqinNo,
      revNo: 1,
      status: 'open' as const,
      frozenAt,
      note: '示例数据的初版修订（开放中，可继续施工或封存）',
      boards: [],
      chambers: [],
      lacquers: [],
      stringings: [],
      counts: {
        boards: SEED_BOARDS.filter((b) => b.guqinNo === guqinNo).length,
        chambers: SEED_CHAMBERS.filter((c) => c.guqinNo === guqinNo).length,
        lacquers: layers.filter((l) => l.guqinNo === guqinNo).length,
        stringings: SEED_STRINGINGS.filter((s) => s.guqinNo === guqinNo).length,
      },
    };
  });

  const own = <T extends { guqinNo: string }>(row: T) => ({
    ...row,
    revisionId: revByGuqin.get(row.guqinNo)!,
  });
  const seedBoards = SEED_BOARDS.map(own);
  const seedChambers = SEED_CHAMBERS.map(own);
  const seedLayers = layers.map(own);
  const seedStringings = SEED_STRINGINGS.map(own);

  await db.transaction(
    'rw',
    [db.boards, db.chambers, db.lacquers, db.stringings, db.revisions, db.meta],
    async () => {
    await db.revisions.bulkPut(seedRevisions);
    await db.boards.bulkPut(seedBoards);
    await db.chambers.bulkPut(seedChambers);
    await db.lacquers.bulkPut(seedLayers);
    await db.stringings.bulkPut(seedStringings);
    await db.meta.put({ key: 'seeded', value: frozenAt });
  });
}
