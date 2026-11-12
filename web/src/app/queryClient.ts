import { QueryClient } from '@tanstack/react-query';
import { ApiError } from '@/api/errors';

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: true,
        // Повторяем только временные сбои; 4xx — сразу показываем.
        retry: (count, error) => error instanceof ApiError && error.retryable && count < 2,
      },
      mutations: { retry: false },
    },
  });
}
