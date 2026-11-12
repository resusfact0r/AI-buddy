import { setupWorker } from 'msw/browser';
import { handlers } from './handlers';
import { enablePersistence, resetDb } from './db';

export async function startMocks(): Promise<void> {
  enablePersistence();
  // Для демо: window.__resetMockDb() сбрасывает тестовые данные.
  (window as unknown as { __resetMockDb: () => void }).__resetMockDb = resetDb;
  await setupWorker(...handlers).start({ onUnhandledRequest: 'bypass', quiet: true });
}
