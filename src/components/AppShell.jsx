import { Link, useLocation } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";

const NAV_ITEMS = [
  { to: "/dashboard", label: "Dashboard" },
  { to: "/students", label: "Students" },
  { to: "/lessons", label: "Lessons" },
  { to: "/payments", label: "Payments" },
  { to: "/calendar", label: "Calendar" },
];

export default function AppShell({ children }) {
  const { user, signOut } = useAuth();
  const { pathname } = useLocation();

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-6">
            <span className="text-lg font-semibold text-gray-900">
              TuitionPay
            </span>
            <nav className="flex items-center gap-4 overflow-x-auto whitespace-nowrap">
              {NAV_ITEMS.map((item) => {
                const active = pathname.startsWith(item.to);
                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    className={
                      active
                        ? "text-sm font-medium text-indigo-600"
                        : "text-sm font-medium text-gray-500 hover:text-gray-900"
                    }
                  >
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-500">{user?.email}</span>
            <button
              onClick={signOut}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-8 px-6 py-8">{children}</main>
    </div>
  );
}
