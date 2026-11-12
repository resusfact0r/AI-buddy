import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http as mswHttp, HttpResponse } from 'msw';
import { server } from '@/mocks/server';
import { config } from '@/config';
import { createAccess, createLeave, db } from '@/mocks/db';
import { USERS } from '@/mocks/data';
import { renderApp } from '@/test/utils';

const anna = USERS.find((u) => u.username === 'intern_anna')!;

describe('ApprovalsPage', () => {
  it('одобрение — карточка исчезает сразу, статус в базе меняется', async () => {
    const r = createLeave(anna, {
      date_from: '2030-01-01',
      date_to: '2030-01-01',
      leave_type: 'day_off',
      comment: 'семья',
    });
    renderApp('/approvals', { as: 'lead_elena' });
    expect(await screen.findByText('«семья»')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: `Одобрить ${r.number}` }));
    expect(screen.queryByText('«семья»')).not.toBeInTheDocument();
    await waitFor(() => expect(db.state.requests[0]!.status).toBe('approved'));
    expect(await screen.findByText('Всё согласовано 🎉')).toBeInTheDocument();
  });

  it('отклонение с комментарием', async () => {
    const [r] = createAccess(anna, ['sys-jira'], 'нужно');
    renderApp('/approvals', { as: 'lead_elena' });
    await screen.findByText('Доступ: Jira');
    await userEvent.click(screen.getByRole('button', { name: 'Добавить комментарий' }));
    await userEvent.type(screen.getByLabelText('Комментарий для сотрудника'), 'пока рано');
    await userEvent.click(screen.getByRole('button', { name: `Отклонить ${r!.number}` }));
    await waitFor(() => expect(db.state.requests[0]!.decision_comment).toBe('пока рано'));
  });

  it('ошибка — откат: карточка возвращается', async () => {
    const r = createLeave(anna, { date_from: '2030-01-01', date_to: '2030-01-01', leave_type: 'day_off' });
    server.use(
      mswHttp.post(`${config.apiUrl}/requests/:id/approve`, () =>
        HttpResponse.json({ error: { code: 'conflict', message: 'Заявка уже отозвана' } }, { status: 409 }),
      ),
    );
    renderApp('/approvals', { as: 'lead_elena' });
    await userEvent.click(await screen.findByRole('button', { name: `Одобрить ${r.number}` }));
    expect(await screen.findByText('Заявка уже отозвана')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: `Одобрить ${r.number}` })).toBeInTheDocument();
  });

  it('главная руководителя показывает заявки', async () => {
    createLeave(anna, { date_from: '2030-01-01', date_to: '2030-01-01', leave_type: 'day_off' });
    renderApp('/', { as: 'lead_elena' });
    expect(await screen.findByText('Ждут вашего решения')).toBeInTheDocument();
    expect(await screen.findByText('Анна Смирнова')).toBeInTheDocument();
  });
});
