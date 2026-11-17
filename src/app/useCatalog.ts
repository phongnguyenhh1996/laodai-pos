import { liveQuery } from 'dexie';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { loadCatalog, type Catalog, type CatalogRefresher, type CatalogStatus, type LaodaiDB } from '@/sync';

export type CatalogState = { status: 'loading' } | { status: 'ready'; catalog: Catalog | undefined };

/** Danh mục đã lưu trên máy; tự cập nhật khi bộ làm mới ghi danh mục mới. */
export function useCatalog(db: LaodaiDB): CatalogState {
  const [state, setState] = useState<CatalogState>({ status: 'loading' });
  useEffect(() => {
    const sub = liveQuery(() => loadCatalog(db)).subscribe({
      next: (catalog) => setState({ status: 'ready', catalog }),
      error: () => setState({ status: 'ready', catalog: undefined }),
    });
    return () => sub.unsubscribe();
  }, [db]);
  return state;
}

export function useCatalogStatus(refresher: CatalogRefresher): CatalogStatus {
  return useSyncExternalStore(
    (cb) => refresher.subscribe(cb),
    () => refresher.getStatus(),
  );
}
