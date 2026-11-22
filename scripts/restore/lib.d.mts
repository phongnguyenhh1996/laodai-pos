import type pg from 'pg';

export interface BackupManifest {
  format: 1;
  created_at: string;
  business_date: string;
  tables: Record<string, number>;
  migrations: Array<{ version: string; name: string | null }>;
}

export interface Snapshot {
  manifest: BackupManifest;
  tables: Record<string, Array<Record<string, unknown>>>;
}

export const CORE_TABLES: string[];
export function parseBackupZip(buf: Uint8Array | ArrayBuffer): Snapshot;
export function loadSnapshot(client: pg.ClientBase, snap: Snapshot, opts?: { chunk?: number }): Promise<void>;
export function finishRestore(client: pg.ClientBase): Promise<void>;
export function verifyCounts(
  client: pg.ClientBase,
  manifest: BackupManifest,
): Promise<Array<{ table: string; expected: number; actual: number }>>;
