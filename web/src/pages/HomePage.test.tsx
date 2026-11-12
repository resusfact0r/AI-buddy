import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useChat } from '@/stores/chat';
import { renderApp } from '@/test/utils';

describe('главная стажёра', () => {
  it('приветствие, наставник и руководитель, прогресс и доступы', async () => {
    renderApp('/', { as: 'intern_anna' });
    expect(await screen.findByText('Дмитрий Волков')).toBeInTheDocument();
    expect(screen.getByText('Елена Морозова')).toBeInTheDocument();
    expect(await screen.findByRole('progressbar', { name: 'Общий прогресс' })).toHaveAttribute(
      'aria-valuenow',
      '30',
    );
    expect(await screen.findByText('1 из 4')).toBeInTheDocument();
  });

  it('«Готово» в следующих шагах и «Спросить AI-buddy»', async () => {
    renderApp('/', { as: 'intern_anna' });
    const steps = await screen.findByRole('region', { name: 'Следующие шаги' }).catch(() => null);
    const scope = steps ?? document.body;
    const done = await within(scope as HTMLElement).findByRole('button', {
      name: /Отметить «Развернуть проект локально» выполненной/,
    });
    await userEvent.click(done);
    await waitFor(() =>
      expect(screen.getByRole('progressbar', { name: 'Общий прогресс' })).toHaveAttribute(
        'aria-valuenow',
        '40',
      ),
    );
    const ask = screen.getAllByRole('button', { name: /Спросить AI-buddy/ })[0]!;
    await userEvent.click(ask);
    expect(useChat.getState().draft).toMatch(/Помоги с задачей/);
    expect(screen.getByRole('tab', { name: 'AI-buddy' })).toHaveAttribute('aria-selected', 'true');
  });

  it('сценарий: «отметь первую выполненной» в чате → панель слева обновилась', async () => {
    renderApp('/', { as: 'intern_anna' });
    const input = await screen.findByLabelText('Сообщение для AI-buddy');
    await userEvent.type(input, 'отметь первую выполненной{Enter}');
    await userEvent.click(await screen.findByRole('button', { name: 'Да, выполнена' }));
    await waitFor(() =>
      expect(screen.getByRole('progressbar', { name: 'Общий прогресс' })).toHaveAttribute(
        'aria-valuenow',
        '40',
      ),
    );
  });
});
