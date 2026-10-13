'use client';

import type { SessionDto } from '@railway/shared';
import type { ReactNode } from 'react';
import { messageFor } from '../lib/messages';
import { useSession } from '../lib/queries';
import { SignInForm } from './SignInForm';
import { ErrorText } from './ui';

/** Renders `children(session)` once signed in; otherwise the sign-in form. */
export function RequireSession({ children }: { children: (session: SessionDto) => ReactNode }) {
  const session = useSession();
  if (session.isPending) return <p className="text-sm text-gray-500">Loading…</p>;
  if (session.isError) return <ErrorText message={messageFor(session.error)} />;
  if (session.data === null) return <SignInForm />;
  return <>{children(session.data)}</>;
}
