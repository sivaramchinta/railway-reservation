import { BookingForm } from '../components/BookingForm';
import { RequireSessionGate } from '../components/RequireSessionGate';

// "/": sign in if needed, then the booking form.
export default function HomePage() {
  return (
    <RequireSessionGate>
      <BookingForm />
    </RequireSessionGate>
  );
}
