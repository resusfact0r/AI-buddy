import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { config } from '@/config';
import { server } from '@/mocks/server';
import { renderUi } from '@/test/utils';
import { qk } from '@/api/queryKeys';
import { FirstDayReadiness } from './FirstDayReadiness';

it('обновляет счётчик после действия агента и скрывает старый результат при ошибке', async () => {
  let ready = 0;
  const path = config.apiUrl + '/onboarding/first-day-readiness';
  server.use(
    http.get(path, () =>
      HttpResponse.json({
        interns: [
          {
            id: 'anna',
            name: 'Анна',
            ready,
            tasks: [{ title: 'Получить доступы', blockers: ready ? [] : ['Заявка ждёт согласования'] }],
          },
        ],
      }),
    ),
  );
  const { client } = renderUi(<FirstDayReadiness />, { as: 'lead_elena' });
  expect(await screen.findByText('Доступно задач: 0 из 1')).toBeInTheDocument();
  ready = 1;
  await client.invalidateQueries({ queryKey: qk.onboarding });
  expect(await screen.findByText('Доступно задач: 1 из 1')).toBeInTheDocument();
  server.use(http.get(path, () => new HttpResponse(null, { status: 503 })));
  await userEvent.click(screen.getByRole('button', { name: 'Проверить снова' }));
  expect(await screen.findByRole('alert')).toBeInTheDocument();
  expect(screen.queryByText('Доступно задач: 1 из 1')).toBeNull();
});
