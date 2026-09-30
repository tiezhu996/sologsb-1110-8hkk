import { db, SCHEMA_VERSION } from './db';
import { revLabel } from '../types/revision';
import type { Revision } from '../types/revision';

export interface BackupPayload {
  app: string;
  schemaVersion: number;
  exportedAt: string;
  /** 封存修订 + 当前开放修订档案 */
  revisions: Revision[];
  boards: unknown[];
  chambers: unknown[];
  lacquers: unknown[];
  stringings: unknown[];
  /** 每张琴的当前（开放）修订标签，备份即标明当前修订 */
  currentRevisions: Array<{ guqinNo: string; revisionId: string; revNo: number; label: string }>;
}

/** 汇总全部本地表为 JSON 备份（含封存修订与当前修订标记） */
export async function buildBackup(): Promise<BackupPayload> {
  const [boards, chambers, lacquers, stringings, revisions] = await Promise.all([
    db.boards.toArray(),
    db.chambers.toArray(),
    db.lacquers.toArray(),
    db.stringings.toArray(),
    db.revisions.toArray(),
  ]);
  const currentRevisions = revisions
    .filter((r) => r.status === 'open')
    .map((r) => ({ guqinNo: r.guqinNo, revisionId: r.id, revNo: r.revNo, label: revLabel(r.revNo) }))
    .sort((a, b) => a.guqinNo.localeCompare(b.guqinNo));
  return {
    app: 'gbguqin',
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    revisions,
    boards,
    chambers,
    lacquers,
    stringings,
    currentRevisions,
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
  downloadText(filename, `﻿${header}\n${body}`, 'text/csv');
}

export interface ImportCounts {
  revisions: number;
  boards: number;
  chambers: number;
  lacquers: number;
  stringings: number;
}

/**
 * 恢复 JSON 备份：修订档案 + 四张工作台表在同一事务里整体替换。
 * 旧版（v2，无 revisions）备份也能导入：按每琴「初版」重建开放修订并补齐归属。
 */
export async function importBackup(text: string): Promise<ImportCounts> {
  const payload = JSON.parse(text) as Partial<BackupPayload>;
  if (!payload || payload.app !== 'gbguqin') {
    throw new Error('备份文件格式不匹配（缺少 app=gbguqin 标记）');
  }

  const boards = (payload.boards ?? []) as Array<Record<string, unknown>>;
  const chambers = (payload.chambers ?? []) as Array<Record<string, unknown>>;
  const lacquers = (payload.lacquers ?? []) as Array<Record<string, unknown>>;
  const stringings = (payload.stringings ?? []) as Array<Record<string, unknown>>;
  const revisions = (payload.revisions ?? []) as Revision[];

  let finalRevisions = revisions;
  let patchRevId = new Map<string, string>();
  if (!revisions.length && boards.length + chambers.length + lacquers.length + stringings.length > 0) {
    // 兼容旧版备份：整档落进各琴初版开放修订
    const at = new Date().toISOString();
    const nos = Array.from(
      new Set(
        [...boards, ...chambers, ...lacquers, ...stringings].map((r) => String(r.guqinNo ?? '')),
      ),
    ).sort();
    finalRevisions = nos.map((guqinNo, i) => ({
      id: `rev-import-${i + 1}`,
      guqinNo,
      revNo: 1,
      status: 'open',
      frozenAt: at,
      note: '旧版备份恢复生成的初版修订',
      boards: [],
      chambers: [],
      lacquers: [],
      stringings: [],
      counts: {
        boards: boards.filter((r) => String(r.guqinNo) === guqinNo).length,
        chambers: chambers.filter((r) => String(r.guqinNo) === guqinNo).length,
        lacquers: lacquers.filter((r) => String(r.guqinNo) === guqinNo).length,
        stringings: stringings.filter((r) => String(r.guqinNo) === guqinNo).length,
      },
    }));
    patchRevId = new Map(finalRevisions.map((r) => [r.guqinNo, r.id]));
  }

  const attach = (rows: Array<Record<string, unknown>>) =>
    rows.map((row) =>
      typeof row.revisionId === 'string' && row.revisionId
        ? row
        : { ...row, revisionId: patchRevId.get(String(row.guqinNo ?? '')) ?? '' },
    );

  await db.transaction('rw', db.boards, db.chambers, db.lacquers, db.stringings, db.revisions, async () => {
    await Promise.all([
      db.boards.clear(),
      db.chambers.clear(),
      db.lacquers.clear(),
      db.stringings.clear(),
      db.revisions.clear(),
    ]);
    if (finalRevisions.length) await db.revisions.bulkAdd(finalRevisions as never[]);
    if (boards.length) await db.boards.bulkAdd(attach(boards) as never[]);
    if (chambers.length) await db.chambers.bulkAdd(attach(chambers) as never[]);
    if (lacquers.length) await db.lacquers.bulkAdd(attach(lacquers) as never[]);
    if (stringings.length) await db.stringings.bulkAdd(attach(stringings) as never[]);
  });

  return {
    revisions: finalRevisions.length,
    boards: boards.length,
    chambers: chambers.length,
    lacquers: lacquers.length,
    stringings: stringings.length,
  };
}
