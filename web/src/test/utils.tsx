import type { ReactElement } from 'react';
import { render } from '@testing-library/react';
import { QueryClient } from '@tanstack/react-query';
import { createMemoryRouter, MemoryRouter, RouterProvider } from 'react-router-dom';
import { Providers } from '@/app/Providers';
import { routes } from '@/app/routes';
import { USERS } from '@/mocks/data';
import { useSession } from '@/stores/session';

export function testQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 0, gcTime: Infinity },
      mutations: { retry: false },
    },
  });
}

export function loginAs(username: string): void {
  const u = USERS.find((x) => x.username === username);
  if (!u) throw new Error(`no user ${username}`);
  useSession.setState({
    token: `mock.${u.username}`,
    user: { id: u.id, username: u.username, display_name: u.display_name, role: u.role, team_id: u.team_id },
    logoutReason: null,
  });
}

/** Всё приложение целиком на заданном маршруте. */
export function renderApp(path: string, opts: { as?: string } = {}) {
  if (opts.as) loginAs(opts.as);
  const client = testQueryClient();
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const utils = render(
    <Providers client={client}>
      <RouterProvider router={router} />
    </Providers>,
  );
  return { ...utils, router, client };
}

/** Отдельный компонент внутри провайдеров и роутера. */
export function renderUi(ui: ReactElement, opts: { as?: string; client?: QueryClient } = {}) {
  if (opts.as) loginAs(opts.as);
  const client = opts.client ?? testQueryClient();
  const utils = render(
    <Providers client={client}>
      <MemoryRouter>{ui}</MemoryRouter>
    </Providers>,
  );
  return { ...utils, client };
}
