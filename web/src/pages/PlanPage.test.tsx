import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http as mswHttp, HttpResponse, delay } from 'msw';
import { server } from '@/mocks/server';
import { config } from '@/config';
import { useChat } from '@/stores/chat';
import { renderApp } from '@/test/utils';

const A = (p: string) => `${config.apiUrl}${p}`;

describe('PlanPage', () => {
  it('get_access заблокирована: подпись и ссылка на доступы', async () => {
    renderApp('/plan', { as: 'intern_anna' });
    const cb = await screen.findByRole('checkbox', { name: /Получить доступы/ });
    expect(cb).toBeDisabled();
    expect(screen.getByText(/Закроется автоматически, когда будут выданы все доступы/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Мои доступы →/ })).toHaveAttribute('href', '/access');
  });

  it('оптимистичная смена статуса применяется сразу', async () => {
    server.use(
      mswHttp.patch(A('/onboarding/tasks/:id'), async () => {
        await delay(100000);
        return HttpResponse.json({});
      }),
    );
    renderApp('/plan', { as: 'intern_anna' });
    const cb = await screen.findByRole('checkbox', { name: /Прочитать гайд по код-ревью/ });
    expect(cb).not.toBeChecked();
    await userEvent.click(cb);
    expect(screen.getByRole('checkbox', { name: /Выполнена: Прочитать гайд/ })).toBeChecked();
  });

  it('откат при ошибке + тост с «Повторить»', async () => {
    server.use(
      mswHttp.patch(A('/onboarding/tasks/:id'), () =>
        HttpResponse.json(
          { error: { code: 'upstream_unavailable', message: 'База недоступна' } },
          { status: 503 },
        ),
      ),
    );
    renderApp('/plan', { as: 'intern_anna' });
    const cb = await screen.findByRole('checkbox', { name: /Прочитать гайд по код-ревью/ });
    await userEvent.click(cb);
    expect(await screen.findByText('База недоступна')).toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen.getByRole('checkbox', { name: /Отметить выполненной: Прочитать гайд/ }),
      ).not.toBeChecked(),
    );
    expect(screen.getByRole('button', { name: 'Повторить' })).toBeInTheDocument();
  });

  it('«В работу», фильтр «только обязательные», «Спросить AI-buddy»', async () => {
    const { router } = renderApp('/plan', { as: 'intern_anna' });
    await screen.findByText('Сходить на обед с командой');
    await userEvent.click(screen.getByRole('switch', { name: 'Только обязательные' }));
    expect(screen.queryByText('Сходить на обед с командой')).not.toBeInTheDocument();
    const row = screen.getByText('Прочитать гайд по код-ревью').closest('li')!;
    await userEvent.click(within(row).getByRole('button', { name: /В работу/ }));
    expect(await within(row).findByText('В работе')).toBeInTheDocument();
    await userEvent.click(within(row).getByRole('button', { name: /Спросить AI-buddy/ }));
    expect(router.state.location.pathname).toBe('/chat');
    expect(useChat.getState().draft).toMatch(/Прочитать гайд по код-ревью/);
  });

  it('ошибка загрузки → «Повторить»', async () => {
    server.use(mswHttp.get(A('/onboarding/plan'), () => HttpResponse.error()));
    renderApp('/plan', { as: 'intern_anna' });
    expect(await screen.findByText(/Нет связи с сервером/)).toBeInTheDocument();
  });
});
