import { Link } from 'react-router-dom';
import { ShieldOff } from 'lucide-react';

export function NoAccessPage() {
  return (
    <div className="card mx-auto flex max-w-lg flex-col items-center gap-3 p-10 text-center">
      <span className="grid h-14 w-14 place-items-center rounded-2xl bg-danger text-white" aria-hidden>
        <ShieldOff className="h-7 w-7" />
      </span>
      <h1 className="text-3xl font-extrabold">Нет доступа</h1>
      <p className="text-ink-soft">
        Этот раздел недоступен для вашей роли. Если вам он нужен — обратитесь к руководителю.
      </p>
      <Link to="/" className="mt-2 rounded-xl bg-ink px-5 py-3 font-bold text-white hover:bg-ink/85">
        На главную
      </Link>
    </div>
  );
}
