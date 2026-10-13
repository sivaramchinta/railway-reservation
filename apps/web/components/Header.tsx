'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSession, useSignOut } from '../lib/queries';
import { ChartStepper } from './ChartStepper';

export function Header() {
  const { data: session } = useSession();
  const signOut = useSignOut();
  const router = useRouter();

  return (
    <header className="border-b border-gray-200 bg-white">
      <div className="mx-auto flex max-w-4xl flex-col gap-3 px-4 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link href="/" className="text-lg font-semibold text-blue-800">
            Mini Railway Reservation
          </Link>
          <nav className="flex items-center gap-4 text-sm">
            <Link href="/" className="hover:underline">
              Book
            </Link>
            {session && (
              <Link href="/bookings" className="hover:underline">
                My bookings
              </Link>
            )}
            {session?.isAdmin === true && (
              <Link href="/admin" className="hover:underline">
                Admin
              </Link>
            )}
            {session && (
              <span className="flex items-center gap-2 text-gray-500">
                {session.email}
                <button
                  type="button"
                  className="text-blue-700 hover:underline"
                  onClick={() => {
                    signOut.mutate(undefined, {
                      onSuccess: () => {
                        router.push('/');
                      },
                    });
                  }}
                >
                  Sign out
                </button>
              </span>
            )}
          </nav>
        </div>
        <ChartStepper />
      </div>
    </header>
  );
}
