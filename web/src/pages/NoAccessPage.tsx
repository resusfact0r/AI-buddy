import { Link } from 'react-router-dom';
import { ShieldOff } from 'lucide-react';

export function NoAccessPage() {
  return (
    <div className="card mx-auto flex max-w-lg flex-col items-center gap-3 p-10 text-center">
      <span className="grid h-14 w-14 place-items-center rounded-2xl bg-danger-soft text-danger" aria-hidden>
        <ShieldOff className="h-7 w-7" />
      </span>
      <h1 className="text-xl font-bold">Нет доступа</h1>
      <p className="text-ink-soft">
        Этот раздел недоступен для вашей роли. Если вам он нужен — обратитесь к руководителю.
      </p>
      <Link
        to="/"
        className="mt-2 rounded-xl bg-brand px-4 py-2.5 font-semibold text-white hover:bg-brand-strong"
      >
        На главную
      </Link>
    </div>
  );
}
