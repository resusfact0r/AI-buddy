import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import type { Role } from '@/api/schemas';
import { useSession } from '@/stores/session';
import { NoAccessPage } from '@/pages/NoAccessPage';

export function RequireAuth({ children }: { children: ReactNode }) {
  const token = useSession((s) => s.token);
  const location = useLocation();
  if (!token) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <>{children}</>;
}

/** Недоступный по роли маршрут — экран «Нет доступа», а не редирект и не падение. */
export function RequireRole({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const role = useSession((s) => s.user?.role);
  if (!role || !roles.includes(role)) return <NoAccessPage />;
  return <>{children}</>;
}
