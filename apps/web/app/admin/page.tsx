import { AdminPanel } from '../../components/AdminPanel';

export default function AdminPage() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Admin</h1>
      <AdminPanel />
    </div>
  );
}
