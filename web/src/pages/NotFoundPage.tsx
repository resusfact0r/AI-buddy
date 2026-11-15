import { Link } from 'react-router-dom';

export function NotFoundPage() {
  return (
    <div className="card mx-auto flex max-w-lg flex-col items-center gap-3 p-10 text-center">
      <p className="text-5xl font-bold tabular-nums text-brand">404</p>
      <h1 className="text-xl font-bold">Страница не найдена</h1>
      <Link
        to="/"
        className="mt-2 rounded-xl bg-brand px-4 py-2.5 font-semibold text-white hover:bg-brand-strong"
      >
        На главную
      </Link>
    </div>
  );
}
