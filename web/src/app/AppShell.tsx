import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { CheckSquare, Home, KeyRound, ListChecks, LogOut, MessageCircle, FileText } from 'lucide-react';
import type { Role } from '@/api/schemas';
import { useSession } from '@/stores/session';
import { useChat } from '@/stores/chat';
import { cn } from '@/lib/cn';
import { Logo } from '@/components/Logo';
import { Avatar } from '@/components/ui/Avatar';
import { ArticleSheet } from '@/features/knowledge/ArticleSheet';
import { useChatSync } from '@/features/chat/useChatSync';

interface NavItem {
  to: string;
  label: string;
  icon: typeof Home;
  roles: Role[];
}

const NAV: NavItem[] = [
  { to: '/', label: 'Главная', icon: Home, roles: ['intern', 'lead', 'buddy'] },
  { to: '/plan', label: 'План адаптации', icon: ListChecks, roles: ['intern'] },
  { to: '/access', label: 'Мои доступы', icon: KeyRound, roles: ['intern'] },
  { to: '/requests', label: 'Мои заявки', icon: FileText, roles: ['intern'] },
  { to: '/approvals', label: 'Согласования', icon: CheckSquare, roles: ['lead'] },
  { to: '/chat', label: 'AI-buddy', icon: MessageCircle, roles: ['intern', 'lead', 'buddy'] },
];

export const ROLE_LABEL: Record<Role, string> = {
  intern: 'Стажёр',
  lead: 'Руководитель',
  buddy: 'Наставник',
};

export function AppShell() {
  const user = useSession((s) => s.user);
  const logout = useSession((s) => s.logout);
  const resetChat = useChat((s) => s.reset);
  const qc = useQueryClient();
  const navigate = useNavigate();
  useChatSync();
  const items = NAV.filter((n) => user && n.roles.includes(user.role));

  const onLogout = () => {
    resetChat();
    qc.clear();
    logout('manual');
    navigate('/login');
  };

  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-white focus:px-3 focus:py-2"
      >
        К содержимому
      </a>
      <header className="sticky top-0 z-30 border-b border-line bg-white">
        <div className="mx-auto flex h-[68px] max-w-[1360px] items-center gap-5 px-4 lg:px-8">
          <NavLink to="/" aria-label="AI-buddy — на главную" className="rounded-lg">
            <Logo />
          </NavLink>
          <nav
            aria-label="Основная навигация"
            className="relative -mx-1 flex min-w-0 flex-1 gap-1 overflow-x-auto px-1 py-1"
          >
            {items.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.to === '/'}
                className={({ isActive }) =>
                  cn(
                    'relative flex shrink-0 items-center gap-2 rounded-full px-3 py-2 text-sm font-bold transition-colors md:px-4',
                    isActive ? 'bg-ink text-white' : 'text-ink hover:bg-canvas',
                  )
                }
              >
                <n.icon className="h-4 w-4" aria-hidden />
                <span className="hidden md:inline">{n.label}</span>
                <span className="sr-only md:hidden">{n.label}</span>
              </NavLink>
            ))}
          </nav>
          {user && (
            <div className="flex items-center gap-3">
              <div className="hidden text-right leading-tight sm:block">
                <div className="text-sm font-bold">{user.display_name}</div>
                <div className="text-xs font-medium text-ink-soft">{ROLE_LABEL[user.role]}</div>
              </div>
              <Avatar name={user.display_name} className="h-9 w-9" />
              <button
                type="button"
                onClick={onLogout}
                className="grid h-10 w-10 place-items-center rounded-full text-ink hover:bg-canvas"
                aria-label="Выйти"
                title="Выйти"
              >
                <LogOut className="h-4 w-4" aria-hidden />
              </button>
            </div>
          )}
        </div>
      </header>
      <main id="main" className="mx-auto w-full max-w-[1360px] flex-1 px-4 py-6 lg:px-8 lg:py-8">
        <Outlet />
      </main>
      <footer className="py-5 text-center text-xs font-medium text-ink-muted">
        AI-buddy · Демо-версия, тестовые данные
      </footer>
      <ArticleSheet />
    </div>
  );
}
