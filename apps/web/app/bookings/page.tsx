import { MyBookings } from '../../components/MyBookings';

export default function MyBookingsPage() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">My bookings</h1>
      <MyBookings />
    </div>
  );
}
