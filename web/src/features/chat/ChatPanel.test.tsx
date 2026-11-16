import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { appendHistory } from '@/mocks/db';
import { useArticle } from '@/features/knowledge/articleStore';
import { ArticleSheet } from '@/features/knowledge/ArticleSheet';
import { renderUi } from '@/test/utils';
import { ChatPanel } from './ChatPanel';
import { FOUND_MS } from './useBuddyMood';

describe('ChatPanel', () => {
  it('подсказки → стрим → источник открывает статью', async () => {
    renderUi(
      <>
        <ChatPanel />
        <ArticleSheet />
      </>,
      { as: 'intern_anna' },
    );
    await userEvent.click(await screen.findByRole('button', { name: /Хочу отгул в пятницу/ }));
    expect(await screen.findByRole('region', { name: 'Заявка на отгул' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Как оформить отгул/ }));
    const dialog = await screen.findByRole('dialog');
    expect(
      await within(dialog).findByRole('heading', { name: 'Как оформить отгул', level: 1 }),
    ).toBeInTheDocument();
    expect(within(dialog).getAllByText(/Демо-версия, тестовые данные/).length).toBeGreaterThan(0);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Закрыть статью' }));
    expect(useArticle.getState().openId).toBeNull();
  });

  it('после ответа над полем ввода остаются незаданные подсказки', async () => {
    renderUi(<ChatPanel />, { as: 'intern_anna' });
    await userEvent.click(await screen.findByRole('button', { name: /Что мне делать дальше/ }));
    const bar = await screen.findByRole('list', { name: 'Можно спросить' });
    expect(within(bar).queryByRole('button', { name: /Что мне делать дальше/ })).toBeNull();
    await userEvent.click(within(bar).getByRole('button', { name: /Какие доступы мне нужны/ }));
    const bar2 = await screen.findByRole('list', { name: 'Можно спросить' });
    expect(within(bar2).queryByRole('button', { name: /Какие доступы мне нужны/ })).toBeNull();
    expect(within(bar2).getByRole('button', { name: /код-ревью/ })).toBeInTheDocument();
  });

  it('Enter отправляет, Shift+Enter — перенос строки', async () => {
    renderUi(<ChatPanel />, { as: 'intern_vera' });
    const input = await screen.findByLabelText('Сообщение для AI-buddy');
    await userEvent.type(input, 'Как у нас{Shift>}{Enter}{/Shift}код-ревью?');
    expect(input).toHaveValue('Как у нас\nкод-ревью?');
    await userEvent.type(input, '{Enter}');
    expect(await screen.findByText(/одного аппрува/)).toBeInTheDocument();
    expect(input).toHaveValue('');
    expect(screen.getByRole('button', { name: /Код-ревью во «Фронтенде Объявлений»/ })).toBeInTheDocument();
  });

  it('ошибка сервиса → «Повторить» работает', async () => {
    renderUi(<ChatPanel />, { as: 'intern_anna' });
    const input = await screen.findByLabelText('Сообщение для AI-buddy');
    await userEvent.type(input, '[[сбой] как у нас код-ревью?{Enter}');
    expect(await screen.findByText(/временно недоступен/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Повторить/ }));
    expect(await screen.findByText(/два ревьюера/)).toBeInTheDocument();
  });

  it('загружает историю при входе', async () => {
    appendHistory('u-anna', { role: 'user', content: 'старый вопрос' });
    appendHistory('u-anna', { role: 'assistant', content: 'старый ответ' });
    renderUi(<ChatPanel />, { as: 'intern_anna' });
    expect(await screen.findByText('старый вопрос')).toBeInTheDocument();
    expect(screen.getByText('старый ответ')).toBeInTheDocument();
  });

  it('безопасный markdown: сырой HTML не рендерится', async () => {
    appendHistory('u-anna', {
      role: 'assistant',
      content: '**жирный** <img src=x onerror="alert(1)"> [ссылка](javascript:alert(1))',
    });
    const { container } = renderUi(<ChatPanel />, { as: 'intern_anna' });
    expect(await screen.findByText('жирный')).toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();
    const link = screen.getByText('ссылка').closest('a');
    expect(link?.getAttribute('href') ?? '').not.toMatch(/javascript/);
  });

  it('пустое состояние с приветствием', async () => {
    renderUi(<ChatPanel />, { as: 'lead_elena' });
    expect(await screen.findByText('Елена, чем помочь?')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Что мне согласовать?' })).toBeInTheDocument(),
    );
  });

  it('Бадди на пустом экране радуется, пока наведён курсор, и уход курсора прерывает радость', async () => {
    renderUi(<ChatPanel />, { as: 'lead_elena' });
    await screen.findByText('Елена, чем помочь?');
    const buddy = screen.getByRole('log').querySelector('svg.buddy')!;
    const target = buddy.parentElement!;
    expect(buddy).toHaveAttribute('data-mood', 'idle');

    vi.useFakeTimers();
    try {
      fireEvent.mouseEnter(target);
      expect(buddy).toHaveAttribute('data-mood', 'found');

      // Пока курсор на Бадди, радость не заканчивается по таймеру.
      act(() => vi.advanceTimersByTime(FOUND_MS * 3));
      expect(buddy).toHaveAttribute('data-mood', 'found');

      // Уход курсора прерывает её сразу, не дожидаясь конца анимации.
      fireEvent.mouseLeave(target);
      expect(buddy).toHaveAttribute('data-mood', 'idle');

      fireEvent.mouseEnter(target);
      expect(buddy).toHaveAttribute('data-mood', 'found');
    } finally {
      vi.useRealTimers();
    }
  });
});
