import { ENV } from './env';

export interface MockMessage {
  token: string;
  chat_id: string;
  text: string;
  at: string;
}

export async function telegramMessages(): Promise<MockMessage[]> {
  return (await (await fetch(`${ENV.telegramMock}/__messages`)).json()) as MockMessage[];
}

export async function telegramClear(): Promise<void> {
  await fetch(`${ENV.telegramMock}/__messages/clear`, { method: 'POST' });
}

/** Chờ tới khi có tin thỏa điều kiện (pg_net + Edge Function chạy bất đồng bộ). */
export async function waitForMessage(pred: (m: MockMessage) => boolean, timeoutMs = 15_000): Promise<MockMessage> {
  const start = Date.now();
  for (;;) {
    const found = (await telegramMessages()).find(pred);
    if (found) return found;
    if (Date.now() - start > timeoutMs) throw new Error('Không thấy tin Telegram mong đợi');
    await new Promise((r) => setTimeout(r, 250));
  }
}
