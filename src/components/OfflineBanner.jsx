import { useOnlineStatus } from "../hooks/useOnlineStatus";

export default function OfflineBanner() {
  const online = useOnlineStatus();

  if (online) return null;

  return (
    <div className="fixed inset-x-0 top-0 z-50 bg-gray-900 px-4 py-2 text-center text-sm font-medium text-white">
      📡 You're offline — your data will sync when you reconnect.
    </div>
  );
}
