import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http as mswHttp, HttpResponse } from 'msw';
import { server } from '@/mocks/server';
import { config } from '@/config';
import { useSession } from '@/stores/session';
import { renderApp } from '@/test/utils';

describe('роутинг по ролям', () => {
  it('без входа → /login', async () => {
    const { router } = renderApp('/plan');
    expect(await screen.findByRole('form', { name: 'Вход' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/login');
  });

  it('стажёр на /approvals → «Нет доступа»', async () => {
    renderApp('/approvals', { as: 'intern_anna' });
    expect(await screen.findByRole('heading', { name: 'Нет доступа' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Согласования/ })).not.toBeInTheDocument();
  });

  it('руководитель на /plan, /access, /requests → «Нет доступа»', async () => {
    for (const p of ['/plan', '/access', '/requests']) {
      const { unmount } = renderApp(p, { as: 'lead_elena' });
      expect(await screen.findByRole('heading', { name: 'Нет доступа' })).toBeInTheDocument();
      unmount();
    }
  });

  it('навигация lead: Согласования есть, План нет', async () => {
    renderApp('/', { as: 'lead_elena' });
    expect(await screen.findByRole('link', { name: /Согласования/ })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /План адаптации/ })).not.toBeInTheDocument();
  });

  it('неизвестный маршрут → 404', async () => {
    renderApp('/nope', { as: 'intern_anna' });
    expect(await screen.findByText('Страница не найдена')).toBeInTheDocument();
  });

  it('401 в процессе работы → экран входа с «Сессия истекла»', async () => {
    server.use(
      mswHttp.get(`${config.apiUrl}/me/profile`, () =>
        HttpResponse.json({ error: { code: 'unauthorized', message: 'expired' } }, { status: 401 }),
      ),
    );
    renderApp('/', { as: 'intern_anna' });
    expect(await screen.findByText(/Сессия истекла/)).toBeInTheDocument();
  });

  it('выход', async () => {
    const { router } = renderApp('/', { as: 'intern_anna' });
    await userEvent.click(await screen.findByRole('button', { name: 'Выйти' }));
    expect(router.state.location.pathname).toBe('/login');
    expect(useSession.getState().token).toBeNull();
  });
});
