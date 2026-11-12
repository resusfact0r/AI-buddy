import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { User } from '@/api/schemas';

export type LogoutReason = 'manual' | 'expired';

interface SessionState {
  token: string | null;
  user: User | null;
  /** Почему разлогинили — чтобы показать «Сессия истекла» на экране входа. */
  logoutReason: LogoutReason | null;
  login: (token: string, user: User) => void;
  setUser: (user: User) => void;
  logout: (reason?: LogoutReason) => void;
}

const safeStorage = createJSONStorage(() => {
  try {
    return window.localStorage;
  } catch {
    return {
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => undefined,
    };
  }
});

export const useSession = create<SessionState>()(
  persist(
    (set) => ({
      token: null,
      user: null,
      logoutReason: null,
      login: (token, user) => set({ token, user, logoutReason: null }),
      setUser: (user) => set({ user }),
      logout: (reason = 'manual') => set({ token: null, user: null, logoutReason: reason }),
    }),
    {
      name: 'ai-buddy-session',
      storage: safeStorage,
      partialize: (s) => ({ token: s.token, user: s.user }),
    },
  ),
);
