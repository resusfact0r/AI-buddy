import '@testing-library/jest-dom/vitest';
import { afterAll, afterEach, beforeAll } from 'vitest';
import { cleanup } from '@testing-library/react';
import { server } from '@/mocks/server';
import { mockTiming } from '@/mocks/handlers';
import { resetDb } from '@/mocks/db';
import { useSession } from '@/stores/session';
import { useChat } from '@/stores/chat';

mockTiming.scale = 0;

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  cleanup();
  server.resetHandlers();
  resetDb();
  useChat.getState().reset();
  useChat.setState({ onActionResult: null });
  useSession.setState({ token: null, user: null, logoutReason: null });
  localStorage.clear();
});
afterAll(() => server.close());

// jsdom не умеет scrollIntoView / scrollTo
Element.prototype.scrollIntoView = function scrollIntoView() {};
Element.prototype.scrollTo = function scrollTo() {} as typeof Element.prototype.scrollTo;
