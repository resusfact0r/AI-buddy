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
    <div className="flex min-h-dvh items-center justify-center bg-[radial-gradient(1200px_600px_at_10%_-10%,#D9F0FF_0%,transparent_60%),radial-gradient(900px_500px_at_110%_110%,#EFE5FF_0%,transparent_55%)] px-4 py-10">
      <div className="w-full max-w-[440px]">
        <div className="mb-8 text-center">
          <div className="mb-4 flex justify-center">
            <Logo size="lg" />
          </div>
          <h1 className="text-[28px] font-extrabold leading-tight tracking-tight">
            Наставник, который всегда рядом
          </h1>
          <p className="mt-2 text-ink-soft">
            Подскажет, что делать дальше, оформит отгул и запросит доступы.
          </p>
        </div>

        <div className="card p-6 sm:p-8">
          {reason === 'expired' && (
            <div
              role="status"
              className="mb-4 flex items-center gap-2 rounded-xl bg-warn-soft px-3 py-2.5 text-sm text-warn"
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
                className="rounded-xl bg-danger-soft px-3 py-2.5 text-sm font-medium text-danger"
              >
                {err.kind === 'unauthorized' ? 'Неверный логин или пароль' : err.message}
              </p>
            )}
            <Button type="submit" size="lg" className="w-full" loading={m.isPending && !pendingUser?.length}>
              Войти
            </Button>
          </form>

          <div className="my-6 flex items-center gap-3 text-xs font-semibold uppercase tracking-wide text-ink-muted">
            <span className="h-px flex-1 bg-line" />
            Быстрый вход для демо
            <span className="h-px flex-1 bg-line" />
          </div>
          <ul className="space-y-2">
            {QUICK.map((q) => (
              <li key={q.username}>
                <button
                  type="button"
                  onClick={() => quick(q.username)}
                  disabled={m.isPending}
                  className="group flex w-full items-center gap-3 rounded-xl border border-line px-3 py-2.5 text-left transition-colors hover:border-brand hover:bg-brand-soft/40 disabled:opacity-60"
                >
                  <Avatar name={q.name} className="h-9 w-9" />
                  <span className="flex-1">
                    <span className="block font-semibold">Войти как {q.name}</span>
                    <span className="block text-xs text-ink-muted">{q.hint}</span>
                  </span>
                  <ArrowRight
                    className="h-4 w-4 text-ink-muted transition-transform group-hover:translate-x-0.5 group-hover:text-brand"
                    aria-hidden
                  />
                </button>
              </li>
            ))}
          </ul>
        </div>
        <p className="mt-6 text-center text-xs text-ink-muted">Демо-версия, тестовые данные</p>
      </div>
    </div>
  );
}
