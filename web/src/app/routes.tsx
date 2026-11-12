import type { RouteObject } from 'react-router-dom';
import { AppShell } from './AppShell';
import { RequireAuth, RequireRole } from './guards';
import { LoginPage } from '@/pages/LoginPage';
import { HomePage } from '@/pages/HomePage';
import { PlanPage } from '@/pages/PlanPage';
import { AccessPage } from '@/pages/AccessPage';
import { RequestsPage } from '@/pages/RequestsPage';
import { ApprovalsPage } from '@/pages/ApprovalsPage';
import { ChatPage } from '@/pages/ChatPage';
import { NotFoundPage } from '@/pages/NotFoundPage';

export const routes: RouteObject[] = [
  { path: '/login', element: <LoginPage /> },
  {
    path: '/',
    element: (
      <RequireAuth>
        <AppShell />
      </RequireAuth>
    ),
    children: [
      { index: true, element: <HomePage /> },
      { path: 'chat', element: <ChatPage /> },
      {
        path: 'plan',
        element: (
          <RequireRole roles={['intern']}>
            <PlanPage />
          </RequireRole>
        ),
      },
      {
        path: 'access',
        element: (
          <RequireRole roles={['intern']}>
            <AccessPage />
          </RequireRole>
        ),
      },
      {
        path: 'requests',
        element: (
          <RequireRole roles={['intern']}>
            <RequestsPage />
          </RequireRole>
        ),
      },
      {
        path: 'approvals',
        element: (
          <RequireRole roles={['lead']}>
            <ApprovalsPage />
          </RequireRole>
        ),
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];
