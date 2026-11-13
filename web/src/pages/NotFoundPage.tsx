import { Link } from 'react-router-dom';

export function NotFoundPage() {
  return (
    <div className="card mx-auto flex max-w-lg flex-col items-center gap-3 p-10 text-center">
      <p className="text-7xl font-extrabold tracking-tighter">
        <span className="mark mark-blue">404</span>
      </p>
      <h1 className="mt-2 text-3xl font-extrabold">Страница не найдена</h1>
      <Link to="/" className="mt-2 rounded-xl bg-ink px-5 py-3 font-bold text-white hover:bg-ink/85">
        На главную
      </Link>
    </div>
  );
}
