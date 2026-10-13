'use client';

import { type SubmitEvent, useState } from 'react';
import { messageFor } from '../lib/messages';
import { useSignIn } from '../lib/queries';
import { buttonClass, Card, ErrorText } from './ui';

/** Demo-grade sign-in: an email address is enough (DESIGN_SPEC §1). */
export function SignInForm() {
  const [email, setEmail] = useState('');
  const signIn = useSignIn();

  function submit(event: SubmitEvent) {
    event.preventDefault();
    signIn.mutate(email);
  }

  return (
    <Card>
      <h2 className="mb-1 text-lg font-semibold">Sign in</h2>
      <p className="mb-4 text-sm text-gray-600">Use any email address. No password is needed.</p>
      <form onSubmit={submit} className="flex flex-col gap-3 sm:flex-row">
        <label className="sr-only" htmlFor="email">
          Email
        </label>
        <input
          id="email"
          type="email"
          required
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
          }}
          placeholder="you@example.com"
          className="flex-1 rounded-md border border-gray-300 px-3 py-2"
        />
        <button type="submit" className={buttonClass} disabled={signIn.isPending}>
          {signIn.isPending ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
      <div className="mt-2">
        <ErrorText message={signIn.isError ? messageFor(signIn.error) : null} />
      </div>
    </Card>
  );
}
