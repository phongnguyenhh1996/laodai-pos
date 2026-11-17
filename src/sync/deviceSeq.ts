import { META, type LaodaiDB } from './db';

/**
 * Cấp device_seq kế tiếp. Phải gọi bên trong transaction 'rw' có bảng meta
 * để số được lưu cùng lúc với đơn ⇒ không nhảy số khi app reload.
 */
export async function nextDeviceSeq(db: LaodaiDB): Promise<number> {
  const cur = ((await db.meta.get(META.deviceSeq))?.value as number | undefined) ?? 0;
  const next = cur + 1;
  await db.meta.put({ key: META.deviceSeq, value: next });
  return next;
}

export async function currentDeviceSeq(db: LaodaiDB): Promise<number> {
  return ((await db.meta.get(META.deviceSeq))?.value as number | undefined) ?? 0;
}

/** Khi kích hoạt lại tablet, tiếp tục từ số lớn nhất server đã thấy (không bao giờ lùi). */
export async function seedDeviceSeq(db: LaodaiDB, serverMax: number): Promise<void> {
  await db.transaction('rw', db.meta, async () => {
    const cur = await currentDeviceSeq(db);
    if (serverMax > cur) await db.meta.put({ key: META.deviceSeq, value: serverMax });
  });
}
