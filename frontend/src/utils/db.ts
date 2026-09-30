import Dexie, { type Table } from 'dexie';
import type { WoodBoard } from '../types/wood-board';
import type { SoundChamber } from '../types/sound-chamber';
import type { LacquerLayer } from '../types/lacquer-layer';
import type { Stringing } from '../types/stringing';
import type { Revision } from '../types/revision';
import { revisionLabel } from '../types/revision';
import { FIRST_REVISION_ID } from '../utils/revision';

/** IndexedDB 库名（浏览器本地存储，无后端） */
export const DB_NAME = 'gbguqin-db';

/** 当前 schema 版本，与 db.version(n) 对应 */
export const SCHEMA_VERSION = 3;

/** 四类工序记录表 */
export const RECORD_TABLES = ['boards', 'chambers', 'lacquers', 'stringings'] as const;

class GuqinDB extends Dexie {
  boards!: Table<WoodBoard, string>;
  chambers!: Table<SoundChamber, string>;
  lacquers!: Table<LacquerLayer, string>;
  stringings!: Table<Stringing, string>;
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
    // 升级前请在顶栏「导出备份」导出 JSON。
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

    // v3：工作台 / 封存修订两套数据所有权。
    // - 新增 revisions 表；四类记录各自挂 revisionId，只归属一份修订；
    // - 旧库升级：四类旧记录整体落进初版 R001（draft），一条原生 versionchange
    //   事务内完成，任何一步失败都会整体回退到完整旧档，不会留下半套新库。
    this.version(3)
      .stores({
        boards: 'id, boardNo, guqinNo, part, species, grain, receivedAt, revisionId',
        chambers: 'id, guqinNo, postPos, carvedAt, revisionId',
        lacquers: 'id, guqinNo, seq, [guqinNo+seq], appliedAt, revisionId',
        stringings: 'id, guqinNo, stringType, strungAt, revisionId',
        revisions: 'id, no, status, sealedAt',
        meta: 'key',
      })
      .upgrade(async (tx) => {
        const snapshot: Record<(typeof RECORD_TABLES)[number], Array<Record<string, unknown>>> = {
          boards: [],
          chambers: [],
          lacquers: [],
          stringings: [],
        };

        for (const name of RECORD_TABLES) {
          const rows = await tx.table(name).toCollection().toArray();
          for (const row of rows) {
            if (!row || typeof row.id !== 'string' || !row.id) {
              // 主键缺失说明旧档已损坏：主动抛错让整笔升级事务回退，保留完整旧库
              throw new Error(`旧档表 ${name} 存在缺少主键 id 的记录，升级中止并回退到完整旧档`);
            }
          }
          snapshot[name] = rows;
        }

        const firstRevision: Revision = {
          id: FIRST_REVISION_ID,
          no: 1,
          label: revisionLabel(1),
          status: 'draft',
          createdAt: new Date().toISOString(),
          note: '旧版工序档案升级生成的初版',
        };
        await tx.table('revisions').add(firstRevision);

        for (const name of RECORD_TABLES) {
          const stamped = snapshot[name].map((row) => ({ ...row, revisionId: FIRST_REVISION_ID }));
          if (stamped.length) {
            await tx.table(name).bulkPut(stamped);
          }
        }
      });
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
