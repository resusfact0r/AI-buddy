import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useSession } from '@/stores/session';
import { renderApp } from '@/test/utils';

describe('LoginPage', () => {
  it('пустая форма — ошибки под полями', async () => {
    renderApp('/login');
    await userEvent.click(await screen.findByRole('button', { name: 'Войти' }));
    expect(screen.getByText('Введите логин')).toBeInTheDocument();
    expect(screen.getByText('Введите пароль')).toBeInTheDocument();
  });

  it('неверный пароль', async () => {
    renderApp('/login');
    await userEvent.type(screen.getByLabelText('Логин'), 'intern_anna');
    await userEvent.type(screen.getByLabelText('Пароль'), 'wrong');
    await userEvent.click(screen.getByRole('button', { name: 'Войти' }));
    expect(await screen.findByText('Неверный логин или пароль')).toBeInTheDocument();
  });

  it('быстрый вход как Анна → главная стажёра', async () => {
    const { router } = renderApp('/login');
    await userEvent.click(screen.getByRole('button', { name: /Войти как Анна/ }));
    expect(await screen.findByRole('heading', { name: /Привет, Анна/ })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/');
    expect(useSession.getState().user?.role).toBe('intern');
    expect(await screen.findByText('Следующие шаги')).toBeInTheDocument();
    expect(await screen.findByText('1 из 4')).toBeInTheDocument();
  });

  it('уже вошли → редирект на главную', async () => {
    const { router } = renderApp('/login', { as: 'intern_vera' });
    await screen.findByRole('heading', { name: /Привет, Вера/ });
    expect(router.state.location.pathname).toBe('/');
  });
});
