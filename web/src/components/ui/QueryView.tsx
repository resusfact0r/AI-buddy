import type { ReactNode } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import { SkeletonCard } from './Skeleton';
import { ErrorState } from './States';

/**
 * Единый рендер состояний запроса: скелетон → ошибка в карточке с повтором → данные.
 * Пустое состояние решает вызывающий код в `children`, т.к. «пусто» у каждого своё.
 */
export function QueryView<T>({
  query,
  loading = <SkeletonCard />,
  children,
}: {
  query: UseQueryResult<T>;
  loading?: ReactNode;
  children: (data: T) => ReactNode;
}) {
  if (query.isPending) return <>{loading}</>;
  if (query.isError)
    return (
      <div className="card">
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      </div>
    );
  return <>{children(query.data)}</>;
}
