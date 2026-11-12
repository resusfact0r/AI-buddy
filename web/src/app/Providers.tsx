import { useState, type ReactNode } from 'react';
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import { createQueryClient } from './queryClient';

export function Providers({ children, client }: { children: ReactNode; client?: QueryClient }) {
  const [qc] = useState(() => client ?? createQueryClient());
  return (
    <QueryClientProvider client={qc}>
      {children}
      <Toaster position="top-center" richColors closeButton toastOptions={{ className: 'font-sans' }} />
    </QueryClientProvider>
  );
}
