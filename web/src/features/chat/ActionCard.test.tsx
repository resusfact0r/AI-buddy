import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http as mswHttp, HttpResponse } from 'msw';
import { server } from '@/mocks/server';
import { config } from '@/config';
import { registerAction } from '@/mocks/db';
import { createLeave } from '@/mocks/db';
import { USERS } from '@/mocks/data';
import type { ActionProposal } from '@/api/schemas';
import { todayIso } from '@/api/schemas';
import { addDays } from '@/lib/dates';
import { useChat, type AssistantMessage } from '@/stores/chat';
import { renderUi } from '@/test/utils';
import { Message } from './Message';

const G = (p: string) => `${config.agentUrl}${p}`;

function seed(proposal: ActionProposal, userId = 'u-anna') {
  registerAction(userId, proposal);
  const msg: AssistantMessage = {
    id: 'm1',
    role: 'assistant',
    text: 'Вот карточка',
    status: null,
    sources: [{ id: 'kb-leave', title: 'Как оформить отгул (тест.)' }],
    actions: [{ proposal, phase: 'proposed' }],
    error: null,
    streaming: false,
    stopped: false,
    replyTo: 'q',
  };
  useChat.setState({ messages: [msg] });
}

function Live() {
  const m = useChat((s) => s.messages[0]);
  return m ? <Message msg={m} /> : null;
}

const tomorrow = addDays(todayIso(), 1);
const leave: ActionProposal = {
  action_id: 'act-leave',
  type: 'leave_request',
  params: { date_from: tomorrow, date_to: tomorrow, leave_type: 'day_off', comment: 'семья' },
};

describe('ActionCard: leave_request', () => {
  it('показывает даты с днём недели и подтверждает', async () => {
    seed(leave);
    renderUi(<Live />, { as: 'intern_anna' });
    const card = screen.getByRole('region', { name: 'Заявка на отгул' });
    expect(within(card).getByText(/1 день/)).toBeInTheDocument();
    expect(within(card).getByText('семья')).toBeInTheDocument();
    await userEvent.click(within(card).getByRole('button', { name: 'Подтвердить' }));
    expect(await within(card).findByText('На согласовании')).toBeInTheDocument();
    expect(within(card).getByText(/Заявка создана/)).toBeInTheDocument();
    expect(within(card).getByRole('link', { name: /Открыть в моих заявках/ })).toHaveAttribute(
      'href',
      '/requests',
    );
  });

  it('«Изменить»: валидация Zod и отправка изменённых params', async () => {
    seed(leave);
    let body: unknown = null;
    server.use(
      mswHttp.post(G('/agent/actions/:id/confirm'), async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ action_id: 'act-leave', status: 'pending', request_numbers: ['REQ-9'] });
      }),
    );
    renderUi(<Live />, { as: 'intern_anna' });
    await userEvent.click(screen.getByRole('button', { name: /Изменить/ }));
    const to = screen.getByLabelText('По');
    await userEvent.clear(to);
    await userEvent.type(to, addDays(todayIso(), -3));
    await userEvent.click(screen.getByRole('button', { name: 'Подтвердить' }));
    expect(await screen.findByText('Дата окончания раньше даты начала')).toBeInTheDocument();
    await userEvent.clear(to);
    await userEvent.type(to, addDays(tomorrow, 30));
    await userEvent.click(screen.getByRole('button', { name: 'Подтвердить' }));
    expect(await screen.findByText(/Не больше 14 дней/)).toBeInTheDocument();
    await userEvent.clear(to);
    await userEvent.type(to, addDays(tomorrow, 2));
    await userEvent.selectOptions(screen.getByLabelText('Тип'), 'vacation');
    expect(screen.getByText('3 дня')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Подтвердить' }));
    expect(await screen.findByText('REQ-9', { exact: false })).toBeInTheDocument();
    expect(body).toEqual({
      params: {
        date_from: tomorrow,
        date_to: addDays(tomorrow, 2),
        leave_type: 'vacation',
        comment: 'семья',
      },
    });
  });

  it('«Отменить правки» возвращает просмотр, «Отменить» — отменяет действие', async () => {
    seed(leave);
    renderUi(<Live />, { as: 'intern_anna' });
    await userEvent.click(screen.getByRole('button', { name: /Изменить/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Отменить правки' }));
    await userEvent.click(screen.getByRole('button', { name: 'Отменить' }));
    expect(screen.getByText(/ничего не отправлено/)).toBeInTheDocument();
    expect(screen.getByText('Отменено')).toBeInTheDocument();
  });

  it('ошибка сети при подтверждении → текст и «Повторить»', async () => {
    seed(leave);
    server.use(mswHttp.post(G('/agent/actions/:id/confirm'), () => HttpResponse.error()));
    renderUi(<Live />, { as: 'intern_anna' });
    await userEvent.click(screen.getByRole('button', { name: 'Подтвердить' }));
    expect(await screen.findByText(/Нет связи с сервером/)).toBeInTheDocument();
    server.resetHandlers();
    await userEvent.click(screen.getByRole('button', { name: /Повторить/ }));
    expect(await screen.findByText('На согласовании')).toBeInTheDocument();
  });

  it('failed-результат: понятный текст и «Повторить» при retryable', async () => {
    seed(leave);
    let calls = 0;
    server.use(
      mswHttp.post(G('/agent/actions/:id/confirm'), () => {
        calls += 1;
        return HttpResponse.json(
          calls === 1
            ? {
                action_id: 'act-leave',
                status: 'failed',
                message: 'Кадровая система недоступна',
                retryable: true,
              }
            : { action_id: 'act-leave', status: 'pending', message: 'Заявка создана' },
        );
      }),
    );
    renderUi(<Live />, { as: 'intern_anna' });
    await userEvent.click(screen.getByRole('button', { name: 'Подтвердить' }));
    expect(await screen.findByText('Кадровая система недоступна')).toBeInTheDocument();
    expect(screen.getByText('Не выполнено')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Повторить/ }));
    expect(await screen.findByText('На согласовании')).toBeInTheDocument();
  });
});

describe('ActionCard: access_request', () => {
  const proposal: ActionProposal = {
    action_id: 'act-acc',
    type: 'access_request',
    params: {
      systems: [
        { id: 'sys-gitlab', name: 'GitLab', purpose: 'Код' },
        { id: 'sys-jira', name: 'Jira', purpose: 'Задачи' },
      ],
      reason: 'Для задач',
    },
  };

  it('по умолчанию отмечены все; снимаем одну — уходит только выбранная', async () => {
    seed(proposal);
    renderUi(<Live />, { as: 'intern_anna' });
    const boxes = screen.getAllByRole('checkbox');
    expect(boxes.every((b) => (b as HTMLInputElement).checked)).toBe(true);
    await userEvent.click(screen.getByLabelText(/Jira/));
    await userEvent.click(screen.getByRole('button', { name: /Запросить выбранные/ }));
    expect(await screen.findByText(/Запросы отправлены руководителю: 1/)).toBeInTheDocument();
  });

  it('ничего не выбрано — кнопка неактивна; пустая причина — ошибка', async () => {
    seed(proposal);
    renderUi(<Live />, { as: 'intern_anna' });
    await userEvent.clear(screen.getByLabelText('Зачем нужен доступ'));
    await userEvent.click(screen.getByRole('button', { name: /Запросить выбранные/ }));
    expect(await screen.findByText(/зачем нужен доступ/i, { selector: '[role=alert]' })).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText(/GitLab/));
    await userEvent.click(screen.getByLabelText(/Jira/));
    expect(screen.getByRole('button', { name: /Запросить выбранные/ })).toBeDisabled();
  });
});

describe('ActionCard: task_status, approve, reject', () => {
  it('task_status: Да → выполнено', async () => {
    seed({
      action_id: 'act-t',
      type: 'task_status',
      params: { task_id: 'dev-env', task_title: 'Развернуть проект', status: 'done' },
    });
    renderUi(<Live />, { as: 'intern_anna' });
    expect(screen.getByText(/«Развернуть проект»/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Да, выполнена' }));
    expect(await screen.findByText('Выполнено')).toBeInTheDocument();
  });

  it('task_status: Нет → отменено', async () => {
    seed({
      action_id: 'act-t2',
      type: 'task_status',
      params: { task_id: 'dev-env', task_title: 'X', status: 'done' },
    });
    renderUi(<Live />, { as: 'intern_anna' });
    await userEvent.click(screen.getByRole('button', { name: 'Нет' }));
    expect(screen.getByText('Отменено')).toBeInTheDocument();
  });

  it('approve с комментарием', async () => {
    const anna = USERS.find((u) => u.username === 'intern_anna')!;
    const r = createLeave(anna, { date_from: '2030-01-01', date_to: '2030-01-01', leave_type: 'day_off' });
    seed(
      {
        action_id: 'act-ap',
        type: 'approve',
        params: {
          request_id: r.id,
          request_number: r.number,
          request_type: 'leave',
          author_name: 'Анна Смирнова',
          summary: 'Отгул',
          reason: 'семья',
        },
      },
      'u-elena',
    );
    renderUi(<Live />, { as: 'lead_elena' });
    await userEvent.type(screen.getByLabelText(/Комментарий/), 'ок');
    await userEvent.click(screen.getByRole('button', { name: 'Подтвердить одобрение' }));
    expect(await screen.findByText('Одобрено')).toBeInTheDocument();
  });

  it('reject без прав → failed без «Повторить»', async () => {
    const anna = USERS.find((u) => u.username === 'intern_anna')!;
    const r = createLeave(anna, { date_from: '2030-01-01', date_to: '2030-01-01', leave_type: 'day_off' });
    seed({
      action_id: 'act-rj',
      type: 'reject',
      params: {
        request_id: r.id,
        request_number: r.number,
        request_type: 'access',
        author_name: 'А',
        summary: 'GitLab',
      },
    });
    renderUi(<Live />, { as: 'intern_anna' });
    expect(screen.getByText('Система')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Подтвердить отказ' }));
    await waitFor(() => expect(screen.getByText('Не выполнено')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /Повторить/ })).not.toBeInTheDocument();
  });
});
