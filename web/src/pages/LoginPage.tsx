import { useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Info } from 'lucide-react';
import { backendApi } from '@/api/backend';
import { toApiError } from '@/api/errors';
import { LoginRequestSchema, type LoginRequest } from '@/api/schemas';
import { useSession } from '@/stores/session';
import { useChat } from '@/stores/chat';
import { prefetchHome } from '@/app/prefetch';
import { Logo } from '@/components/Logo';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { Avatar } from '@/components/ui/Avatar';

const QUICK: { username: string; name: string; hint: string }[] = [
  { username: 'intern_anna', name: 'Анна', hint: 'стажёр, «Доставка»' },
  { username: 'intern_vera', name: 'Вера', hint: 'стажёр, другая команда' },
  { username: 'lead_elena', name: 'Елена', hint: 'руководитель' },
];
const DEMO_PASSWORD = 'test1234';

export function LoginPage() {
  const token = useSession((s) => s.token);
  const reason = useSession((s) => s.logoutReason);
  const login = useSession((s) => s.login);
  const resetChat = useChat((s) => s.reset);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState<LoginRequest>({ username: '', password: '' });
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof LoginRequest, string>>>({});

  const m = useMutation({
    mutationFn: backendApi.login,
    onSuccess: async (data) => {
      qc.clear();
      resetChat();
      login(data.access_token, data.user);
      // Не ждём дольше 1,5 с — главная всё равно покажет скелетоны.
      await Promise.race([prefetchHome(qc, data.user.role), new Promise((r) => setTimeout(r, 1500))]);
      const from = (location.state as { from?: string } | null)?.from;
      navigate(from && from !== '/login' ? from : '/', { replace: true });
    },
  });

  if (token && !m.isPending && !m.isSuccess) return <Navigate to="/" replace />;

  const submit = (values: LoginRequest) => {
    const parsed = LoginRequestSchema.safeParse(values);
    if (!parsed.success) {
      const errs: typeof fieldErrors = {};
      for (const i of parsed.error.issues) errs[i.path[0] as keyof LoginRequest] = i.message;
      setFieldErrors(errs);
      return;
    }
    setFieldErrors({});
    m.mutate(parsed.data);
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    submit(form);
  };

  const quick = (username: string) => {
    const values = { username, password: DEMO_PASSWORD };
    setForm(values);
    submit(values);
  };

  const err = m.error ? toApiError(m.error) : null;
  const pendingUser = m.isPending ? m.variables?.username : null;

  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <div className="mx-auto grid w-full max-w-[1160px] flex-1 items-center gap-10 px-4 py-10 lg:grid-cols-[1.1fr_minmax(0,460px)] lg:gap-16 lg:px-8">
        <div>
          <Logo size="lg" />
          <h1 className="mt-8 text-[40px] font-extrabold leading-[1.15] tracking-tight sm:text-[56px] lg:mt-12">
            <span className="mark mark-green">Наставник,</span>
            <br />
            <span className="mark mark-blue mt-1">который всегда рядом</span>
          </h1>
          <p className="mt-6 max-w-md text-lg font-medium text-ink-soft sm:text-xl">
            Подскажет, что делать дальше, оформит отгул и запросит доступы.
          </p>
        </div>

        <div className="card p-6 sm:p-8">
          <h2 className="mb-5 text-2xl font-extrabold">Вход</h2>
          {reason === 'expired' && (
            <div
              role="status"
              className="mb-4 flex items-center gap-2 rounded-xl bg-warn-soft px-3.5 py-3 text-sm font-semibold text-ink"
            >
              <Info className="h-4 w-4 shrink-0" aria-hidden />
              Сессия истекла — войдите снова.
            </div>
          )}
          <form onSubmit={onSubmit} noValidate className="space-y-4" aria-label="Вход">
            <Field label="Логин" error={fieldErrors.username}>
              <input
                className="input"
                autoComplete="username"
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
                placeholder="intern_anna"
              />
            </Field>
            <Field label="Пароль" error={fieldErrors.password}>
              <input
                className="input"
                type="password"
                autoComplete="current-password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
              />
            </Field>
            {err && (
              <p
                role="alert"
                className="rounded-xl bg-danger-soft px-3.5 py-3 text-sm font-semibold text-ink"
              >
                {err.kind === 'unauthorized' ? 'Неверный логин или пароль' : err.message}
              </p>
            )}
            <Button type="submit" size="lg" className="w-full" loading={m.isPending && !pendingUser?.length}>
              Войти
            </Button>
          </form>

          <p className="eyebrow mb-3 mt-8">Быстрый вход для демо</p>
          <ul className="space-y-2">
            {QUICK.map((q) => (
              <li key={q.username}>
                <button
                  type="button"
                  onClick={() => quick(q.username)}
                  disabled={m.isPending}
                  className="group flex w-full items-center gap-3 rounded-2xl bg-canvas px-3.5 py-3 text-left transition-colors hover:bg-line disabled:opacity-60"
                >
                  <Avatar name={q.name} />
                  <span className="flex-1">
                    <span className="block font-bold">Войти как {q.name}</span>
                    <span className="block text-sm text-ink-soft">{q.hint}</span>
                  </span>
                  <ArrowRight
                    className="h-5 w-5 text-ink transition-transform group-hover:translate-x-1"
                    aria-hidden
                  />
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <p className="pb-6 text-center text-xs font-medium text-ink-muted">Демо-версия, тестовые данные</p>
    </div>
  );
}
