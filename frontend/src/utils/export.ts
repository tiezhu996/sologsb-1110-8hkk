import { db, SCHEMA_VERSION } from './db';
import { useRevisionStore } from '../stores/revisionStore';

export interface BackupPayload {
  app: string;
  schemaVersion: number;
  exportedAt: string;
  /** 备份时正在查看的修订（恢复后默认停在该修订） */
  currentRevisionId?: string;
  boards: unknown[];
  chambers: unknown[];
  lacquers: unknown[];
  stringings: unknown[];
  revisions: unknown[];
}

/** 汇总全部本地表为 JSON 备份（schema 迁移前先导出） */
export async function buildBackup(): Promise<BackupPayload> {
  const [boards, chambers, lacquers, stringings, revisions] = await Promise.all([
    db.boards.toArray(),
    db.chambers.toArray(),
    db.lacquers.toArray(),
    db.stringings.toArray(),
    db.revisions.toArray(),
  ]);
  return {
    app: 'gbguqin',
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    currentRevisionId: useRevisionStore().viewingId || undefined,
    boards,
    chambers,
    lacquers,
    stringings,
    revisions,
  };
}

export async function exportBackupJson(): Promise<string> {
  return JSON.stringify(await buildBackup(), null, 2);
}

export function downloadText(filename: string, text: string, mime = 'application/json'): void {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** 导出 CSV（工序档案打印用） */
export function downloadCsv<T extends Record<string, unknown>>(
  filename: string,
  rows: T[],
  columns: Array<{ key: keyof T; title: string }>,
): void {
  const header = columns.map((c) => `"${c.title}"`).join(',');
  const body = rows
    .map((row) => columns.map((c) => `"${String(row[c.key] ?? '').replace(/"/g, '""')}"`).join(','))
    .join('\n');
  downloadText(filename, `\ufeff${header}\n${body}`, 'text/csv');
}

/**
 * 恢复 JSON 备份（含修订体系）。整库覆盖写入一笔事务：任何一步失败都整体回退，
 * 不会把本地库写成半套。
 * 返回修订与四类记录条数。
 */
export async function importBackup(text: string): Promise<{
  boards: number;
  chambers: number;
  lacquers: number;
  stringings: number;
  revisions: number;
}> {
  const payload = JSON.parse(text) as Partial<BackupPayload>;
  if (!payload || payload.app !== 'gbguqin') {
    throw new Error('备份文件格式不匹配（缺少 app=gbguqin 标记）');
  }
  // 兼容旧版备份（无 revisions）：恢复进来的旧记录统一归到初版 R001
  const useFallbackRevision = !payload.revisions?.length;
  const fallbackRevisionId = 'rev-0001';
  const stampRows = (rows: unknown[] | undefined) =>
    (rows ?? []).map((row) => (useFallbackRevision ? { ...(row as object), revisionId: fallbackRevisionId } : row));

  const counts = {
    boards: payload.boards?.length ?? 0,
    chambers: payload.chambers?.length ?? 0,
    lacquers: payload.lacquers?.length ?? 0,
    stringings: payload.stringings?.length ?? 0,
    revisions: payload.revisions?.length ?? (useFallbackRevision ? 1 : 0),
  };

  await db.transaction(
    'rw',
    [db.boards, db.chambers, db.lacquers, db.stringings, db.revisions, db.meta],
    async () => {
      await Promise.all([
        db.boards.clear(),
        db.chambers.clear(),
        db.lacquers.clear(),
        db.stringings.clear(),
        db.revisions.clear(),
      ]);
      if (useFallbackRevision) {
        const fallbackId: string = fallbackRevisionId;
        await db.revisions.add({
          id: fallbackId,
          no: 1,
          label: 'R001',
          status: 'draft',
          createdAt: payload.exportedAt ?? new Date().toISOString(),
          note: '由旧版备份恢复生成的初版',
        });
      } else if (payload.revisions?.length) {
        await db.revisions.bulkPut(payload.revisions as never[]);
      }
      const boards = stampRows(payload.boards);
      const chambers = stampRows(payload.chambers);
      const lacquers = stampRows(payload.lacquers);
      const stringings = stampRows(payload.stringings);
      if (boards.length) await db.boards.bulkPut(boards as never[]);
      if (chambers.length) await db.chambers.bulkPut(chambers as never[]);
      if (lacquers.length) await db.lacquers.bulkPut(lacquers as never[]);
      if (stringings.length) await db.stringings.bulkPut(stringings as never[]);
    },
  );
  return counts;
}
