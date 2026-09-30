import Dexie, { type Table, type Transaction } from 'dexie';
import type { WoodBoard } from '../types/wood-board';
import type { SoundChamber } from '../types/sound-chamber';
import type { LacquerLayer } from '../types/lacquer-layer';
import type { Stringing } from '../types/stringing';
import type { Revision } from '../types/revision';

/** IndexedDB 库名（浏览器本地存储，无后端） */
export const DB_NAME = 'gbguqin-db';

/** 当前 schema 版本，与 db.version(n) 对应 */
export const SCHEMA_VERSION = 3;

/** 工作台四类记录统一携带的归属字段 */
export interface RevisionOwned {
  /** 所属开放修订 id */
  revisionId: string;
}

export type OwnedWoodBoard = WoodBoard & RevisionOwned;
export type OwnedSoundChamber = SoundChamber & RevisionOwned;
export type OwnedLacquerLayer = LacquerLayer & RevisionOwned;
export type OwnedStringing = Stringing & RevisionOwned;

/** 升级期内可识别的最小行结构（旧库行未必带全部字段） */
interface LegacyRow {
  id: string;
  guqinNo?: string;
  [key: string]: unknown;
}

/** 深拷贝，避免封存快照与续开工作台行共享对象引用 */
function snapshotRows<T>(rows: T[]): T[] {
  return JSON.parse(JSON.stringify(rows)) as T[];
}

/** 修订 id：sealed/open 前缀区分，同一毫秒内仍靠序号唯一 */
function revId(kind: 's' | 'o', index: number): string {
  return `rev-${Date.now().toString(36)}-${kind}${index}`;
}

/** 续开工作台行 id 由旧 id 确定性派生：旧 id 唯一则新 id 必唯一 */
function carriedId(oldId: string): string {
  return `${oldId}~open`;
}

/**
 * v2→v3 升级体：旧数据落进各琴「初版」封存修订，并续开第 2 版作为工作台。
 *
 * 整个过程跑在 IndexedDB 单个 versionchange 事务里：
 * 任一步抛错都会回滚——旧四张表原样保留，revisions 也不会留下半套新库，
 * 下次打开仍是完整旧档，可重新升级。
 */
async function migrateV2ToV3(tx: Transaction): Promise<void> {
  const boardsTable = tx.table<LegacyRow, string>('boards');
  const chambersTable = tx.table<LegacyRow, string>('chambers');
  const lacquersTable = tx.table<LegacyRow, string>('lacquers');
  const stringingsTable = tx.table<LegacyRow, string>('stringings');
  const revisionsTable = tx.table<Revision, string>('revisions');

  const [boards, chambers, lacquers, stringings] = await Promise.all([
    boardsTable.toCollection().toArray(),
    chambersTable.toCollection().toArray(),
    lacquersTable.toCollection().toArray(),
    stringingsTable.toCollection().toArray(),
  ]);

  type Group = { boards: LegacyRow[]; chambers: LegacyRow[]; lacquers: LegacyRow[]; stringings: LegacyRow[] };
  const groups = new Map<string, Group>();
  const bucket = (guqinNo: string): Group => {
    let g = groups.get(guqinNo);
    if (!g) {
      g = { boards: [], chambers: [], lacquers: [], stringings: [] };
      groups.set(guqinNo, g);
    }
    return g;
  };

  boards.forEach((r: LegacyRow) => bucket(String(r.guqinNo ?? '')).boards.push(r));
  chambers.forEach((r: LegacyRow) => bucket(String(r.guqinNo ?? '')).chambers.push(r));
  lacquers.forEach((r: LegacyRow) => bucket(String(r.guqinNo ?? '')).lacquers.push(r));
  stringings.forEach((r: LegacyRow) => bucket(String(r.guqinNo ?? '')).stringings.push(r));

  const sealedRevisions: Revision[] = [];
  const openRevisions: Revision[] = [];
  /** 续开后要写回四张工作台表的行（新 id + revisionId） */
  const nextBoards: LegacyRow[] = [];
  const nextChambers: LegacyRow[] = [];
  const nextLacquers: LegacyRow[] = [];
  const nextStringings: LegacyRow[] = [];

  let index = 0;
  for (const [guqinNo, g] of groups) {
    index += 1;
    const frozenAt = new Date().toISOString();
    const sealedId = revId('s', index);
    const openId = revId('o', index);

    const snapBoards = snapshotRows(g.boards);
    const snapChambers = snapshotRows(g.chambers);
    const snapLacquers = snapshotRows(g.lacquers);
    const snapStringings = snapshotRows(g.stringings);

    // 初版：旧验收结果只读冻结
    sealedRevisions.push({
      id: sealedId,
      guqinNo,
      revNo: 1,
      status: 'sealed',
      frozenAt,
      note: '旧档升级生成的初版修订',
      boards: snapBoards as unknown as WoodBoard[],
      chambers: snapChambers as unknown as SoundChamber[],
      lacquers: snapLacquers as unknown as LacquerLayer[],
      stringings: snapStringings as unknown as Stringing[],
      counts: {
        boards: snapBoards.length,
        chambers: snapChambers.length,
        lacquers: snapLacquers.length,
        stringings: snapStringings.length,
      },
    });

    // 第 2 版：工作台开放修订，四张表的实际数据挂在它名下
    openRevisions.push({
      id: openId,
      guqinNo,
      revNo: 2,
      status: 'open',
      frozenAt,
      sourceRevisionId: sealedId,
      boards: [],
      chambers: [],
      lacquers: [],
      stringings: [],
      counts: {
        boards: g.boards.length,
        chambers: g.chambers.length,
        lacquers: g.lacquers.length,
        stringings: g.stringings.length,
      },
    });

    // 旧行复制成新 id 的工作台行（保留全部业务字段），与封存快照彻底分家
    g.boards.forEach((r) => nextBoards.push({ ...r, id: carriedId(r.id), revisionId: openId }));
    g.chambers.forEach((r) => nextChambers.push({ ...r, id: carriedId(r.id), revisionId: openId }));
    g.lacquers.forEach((r) => nextLacquers.push({ ...r, id: carriedId(r.id), revisionId: openId }));
    g.stringings.forEach((r) => nextStringings.push({ ...r, id: carriedId(r.id), revisionId: openId }));
  }

  // 先清空旧四张表（同一事务，提交前失败可整体回滚）
  await Promise.all([boardsTable.clear(), chambersTable.clear(), lacquersTable.clear(), stringingsTable.clear()]);

  // 修订档案 + 续开工作台行一次写入
  await revisionsTable.bulkAdd([...sealedRevisions, ...openRevisions]);
  await Promise.all([
    nextBoards.length ? boardsTable.bulkAdd(nextBoards) : Promise.resolve(),
    nextChambers.length ? chambersTable.bulkAdd(nextChambers) : Promise.resolve(),
    nextLacquers.length ? lacquersTable.bulkAdd(nextLacquers) : Promise.resolve(),
    nextStringings.length ? stringingsTable.bulkAdd(nextStringings) : Promise.resolve(),
  ]);
}

class GuqinDB extends Dexie {
  boards!: Table<OwnedWoodBoard, string>;
  chambers!: Table<OwnedSoundChamber, string>;
  lacquers!: Table<OwnedLacquerLayer, string>;
  stringings!: Table<OwnedStringing, string>;
  revisions!: Table<Revision, string>;
  meta!: Table<{ key: string; value: string }, string>;

  constructor() {
    super(DB_NAME);

    // v1：建表声明索引
    this.version(1).stores({
      boards: 'id, boardNo, guqinNo, part, species, grain, receivedAt',
      chambers: 'id, guqinNo, postPos, carvedAt',
      lacquers: 'id, guqinNo, seq, appliedAt',
      stringings: 'id, guqinNo, stringType, strungAt',
      meta: 'key',
    });

    // v2：髹漆表增加 (guqinNo+seq) 复合索引，便于按遍次排序查询；并回填历史 layerThickness。
    this.version(2)
      .stores({
        boards: 'id, boardNo, guqinNo, part, species, grain, receivedAt',
        chambers: 'id, guqinNo, postPos, carvedAt',
        lacquers: 'id, guqinNo, seq, [guqinNo+seq], appliedAt',
        stringings: 'id, guqinNo, stringType, strungAt',
        meta: 'key',
      })
      .upgrade(async (tx) => {
        await tx
          .table('lacquers')
          .toCollection()
          .modify((row: LacquerLayer) => {
            if (!row.layerThickness && row.totalThickness) {
              row.layerThickness = row.totalThickness;
            }
          });
      });

    // v3：工作台 / 封存修订两套所有权。
    // 四类表加 revisionId 归属索引；新增 revisions 封存档案表。
    // 旧库整档进各琴「初版」（sealed），续开第 2 版（open）；升级失败由 IndexedDB 事务回滚。
    this.version(3)
      .stores({
        boards: 'id, boardNo, guqinNo, revisionId, part, species, grain, receivedAt',
        chambers: 'id, guqinNo, revisionId, postPos, carvedAt',
        lacquers: 'id, guqinNo, revisionId, seq, [guqinNo+seq], appliedAt',
        stringings: 'id, guqinNo, revisionId, stringType, strungAt',
        revisions: 'id, guqinNo, revNo, status, frozenAt',
        meta: 'key',
      })
      .upgrade(migrateV2ToV3);
  }
}

export const db = new GuqinDB();

export async function getMeta(key: string): Promise<string | undefined> {
  const row = await db.meta.get(key);
  return row?.value;
}

export async function setMeta(key: string, value: string): Promise<void> {
  await db.meta.put({ key, value });
}
