import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Header } from '../components/Header';
import './globals.css';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: 'Mini Railway Reservation',
  description: 'Book seats on the Demo Express',
};

// A Server Component: it only arranges the page. Interactive parts are Client Components.
export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-gray-50 text-gray-900">
        <Providers>
          <Header />
          <main className="mx-auto max-w-4xl px-4 py-6">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
