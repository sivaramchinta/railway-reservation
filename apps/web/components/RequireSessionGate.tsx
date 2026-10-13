'use client';

import type { ReactNode } from 'react';
import { RequireSession } from './RequireSession';

/** RequireSession for Server Component pages, which cannot pass a render function. */
export function RequireSessionGate({ children }: { children: ReactNode }) {
  return <RequireSession>{() => children}</RequireSession>;
}
