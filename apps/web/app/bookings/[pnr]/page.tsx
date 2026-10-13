import { BookingDetail } from '../../../components/BookingDetail';

// In Next.js 16, `params` is a Promise: a Server Component awaits it.
export default async function BookingPage({ params }: { params: Promise<{ pnr: string }> }) {
  const { pnr } = await params;
  return <BookingDetail pnr={pnr} />;
}
