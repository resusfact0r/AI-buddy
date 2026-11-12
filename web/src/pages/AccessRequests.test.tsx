import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http as mswHttp, HttpResponse } from 'msw';
import { server } from '@/mocks/server';
import { config } from '@/config';
import { createLeave, decide } from '@/mocks/db';
import { USERS } from '@/mocks/data';
import { todayIso } from '@/api/schemas';
import { addDays } from '@/lib/dates';
import { renderApp } from '@/test/utils';

const u = (n: string) => USERS.find((x) => x.username === n)!;

describe('Мои доступы', () => {
  it('таблица и ручной запрос одной системы', async () => {
    renderApp('/access', { as: 'intern_anna' });
    expect(await screen.findByText('GitLab')).toBeInTheDocument();
    expect(screen.getAllByText('Не хватает')).toHaveLength(3);
    await userEvent.click(screen.getByRole('button', { name: 'Запросить доступ к Jira' }));
    const dialog = await screen.findByRole('dialog', { name: 'Запрос доступа' });
    await userEvent.click(within(dialog).getByRole('button', { name: /Запросить/ }));
    expect(await within(dialog).findByText(/Коротко опишите/)).toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText('Зачем нужен доступ'), 'Задачи спринта');
    await userEvent.click(within(dialog).getByRole('button', { name: /Запросить/ }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(await screen.findByText('Запрошен')).toBeInTheDocument();
  });

  it('409 «уже запрошен» показывается в форме', async () => {
    server.use(
      mswHttp.post(`${config.apiUrl}/requests/access`, () =>
        HttpResponse.json(
          { error: { code: 'conflict', message: 'Доступ к GitLab уже запрошен' } },
          { status: 409 },
        ),
      ),
    );
    renderApp('/access', { as: 'intern_anna' });
    await userEvent.click(await screen.findByRole('button', { name: /Запросить все недостающие/ }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Зачем нужен доступ'), 'Задачи спринта');
    await userEvent.click(within(dialog).getByRole('button', { name: /Запросить/ }));
    expect(await within(dialog).findByText('Доступ к GitLab уже запрошен')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Отменить' }));
  });
});

describe('Мои заявки', () => {
  it('пусто → оформить отгул вручную → заявка в списке', async () => {
    renderApp('/requests', { as: 'intern_anna' });
    expect(await screen.findByText('Заявок пока нет')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Оформить отгул вручную/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Оформить отгул' });
    const d = addDays(todayIso(), 2);
    await userEvent.type(within(dialog).getByLabelText('С'), d);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Отправить заявку' }));
    const list = await screen.findByRole('list', { name: 'Список заявок' });
    expect(within(list).getByText('На согласовании')).toBeInTheDocument();
  });

  it('серверная validation_error → ошибка под полем', async () => {
    server.use(
      mswHttp.post(`${config.apiUrl}/requests/leave`, () =>
        HttpResponse.json(
          {
            error: {
              code: 'validation_error',
              message: 'bad',
              details: { fields: { date_from: 'Этот день уже занят' } },
            },
          },
          { status: 400 },
        ),
      ),
    );
    renderApp('/requests', { as: 'intern_anna' });
    await userEvent.click(await screen.findByRole('button', { name: /Оформить отгул вручную/ }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('С'), addDays(todayIso(), 2));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Отправить заявку' }));
    expect(await within(dialog).findByText('Этот день уже занят')).toBeInTheDocument();
  });

  it('фильтры и детали с комментарием руководителя', async () => {
    const r = createLeave(u('intern_anna'), {
      date_from: '2030-01-01',
      date_to: '2030-01-02',
      leave_type: 'day_off',
      comment: 'семья',
    });
    decide(u('lead_elena'), r.id, 'approved', 'Хорошего отдыха');
    renderApp('/requests', { as: 'intern_anna' });
    await userEvent.click(await screen.findByRole('radio', { name: 'Доступы' }));
    expect(await screen.findByText('Нет заявок по фильтру')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: 'Отгулы' }));
    await userEvent.click(screen.getByRole('radio', { name: 'Одобрены' }));
    await userEvent.click(await screen.findByRole('button', { name: /Отгул/ }));
    const dialog = await screen.findByRole('dialog', { name: `Заявка ${r.number}` });
    expect(await within(dialog).findByText('Хорошего отдыха')).toBeInTheDocument();
    expect(within(dialog).getByText(/Елена Морозова/)).toBeInTheDocument();
  });
});
