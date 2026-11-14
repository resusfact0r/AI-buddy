import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { z } from 'zod';
import { backendHttp } from '@/api/http';
import { qk } from '@/api/queryKeys';
import { useSession } from '@/stores/session';

const reportSchema = z.object({
  interns: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      ready: z.number(),
      tasks: z.array(z.object({ title: z.string(), blockers: z.array(z.string()) })),
    }),
  ),
});

export function FirstDayReadiness() {
  const [selected, setSelected] = useState('');
  const lead = useSession((s) => s.user?.id);
  const q = useQuery({
    queryKey: [...qk.readiness, lead],
    queryFn: () => backendHttp('/onboarding/first-day-readiness', { schema: reportSchema }),
  });
  const interns = q.data?.interns ?? [];
  const intern = interns.find((p) => p.id === selected) ?? interns[0];
  return (
    <section className="card space-y-3 p-5" aria-label="Готовность первого дня">
      <h2 className="text-lg font-bold">Готовность первого дня</h2>
      <p className="text-sm text-ink-soft">
        Какие задачи стажёр сможет начать с текущими доступами и инструкциями?
      </p>
      {q.isLoading && <p role="status">Проверяем план…</p>}
      {q.isError && <p role="alert">Не удалось проверить план.</p>}
      {q.isSuccess && !intern && <p>В вашей команде пока нет стажёров.</p>}
      {q.isSuccess && intern && (
        <>
          <label className="block">
            Стажёр
            <select className="input mt-1" value={intern.id} onChange={(e) => setSelected(e.target.value)}>
              {interns.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          {intern.tasks.length ? (
            <strong>
              Доступно задач: {intern.ready} из {intern.tasks.length}
            </strong>
          ) : (
            <p>План первого дня пока пуст.</p>
          )}
          <ul className="space-y-2">
            {intern.tasks.map((t, i) => (
              <li key={i}>
                <b>{t.title}</b>
                {t.blockers.length ? (
                  <ul className="text-sm text-warn">
                    {t.blockers.map((b) => (
                      <li key={b}>{b}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm">Можно начать</p>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      <div className="flex gap-4 text-sm font-semibold text-brand">
        <button type="button" disabled={q.isFetching} onClick={() => void q.refetch()}>
          Проверить снова
        </button>
        <Link to="/approvals">Открыть согласования →</Link>
      </div>
    </section>
  );
}
