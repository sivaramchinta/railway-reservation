'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';

/**
 * React context (and so TanStack Query) only works in Client Components, so the
 * provider is its own client component that the server layout renders.
 */
export function Providers({ children }: { children: ReactNode }) {
  // One QueryClient per browser tab (useState keeps it across re-renders).
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: 1000, refetchOnWindowFocus: true } },
      }),
  );
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
