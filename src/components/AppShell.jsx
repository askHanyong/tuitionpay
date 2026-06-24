import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";

const ICONS = {
  dashboard: (
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M3 12l9-9 9 9M5 10v10a1 1 0 001 1h4a1 1 0 001-1v-4a1 1 0 011-1h0a1 1 0 011 1v4a1 1 0 001 1h4a1 1 0 001-1V10"
    />
  ),
  students: (
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 014-4h2a4 4 0 014 4v2H9zm0-2v0M9 11a4 4 0 100-8 4 4 0 000 8zm7-1a3 3 0 100-6 3 3 0 000 6z"
    />
  ),
  lessons: (
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M12 6.04C10.5 4.6 8 4 5.5 4 4 4 3 4.3 3 4.3v13.4S4 17 5.5 17c2.5 0 5 .6 6.5 2 1.5-1.4 4-2 6.5-2 1.5 0 2.5.4 2.5.4V4.3S20 4 18.5 4c-2.5 0-5 .6-6.5 2.04zM12 6v13"
    />
  ),
  payments: (
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M12 8c-1.66 0-3 .9-3 2s1.34 2 3 2 3 .9 3 2-1.34 2-3 2m0-8c1.3 0 2.4.6 2.8 1.5M12 8V6m0 10v2M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
    />
  ),
  calendar: (
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
    />
  ),
  settings: (
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065zM15 12a3 3 0 11-6 0 3 3 0 016 0z"
    />
  ),
};

const NAV_ITEMS = [
  { to: "/dashboard", label: "Dashboard", icon: "dashboard" },
  { to: "/students", label: "Students", icon: "students" },
  { to: "/lessons", label: "Lessons", icon: "lessons" },
  { to: "/payments", label: "Payments", icon: "payments" },
  { to: "/calendar", label: "Calendar", icon: "calendar" },
  { to: "/settings", label: "Settings", icon: "settings" },
];

function NavIcon({ name, className }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      aria-hidden="true"
    >
      {ICONS[name]}
    </svg>
  );
}

function CloverLogo({ className }) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 100 110"
      aria-hidden="true"
    >
      <g transform="translate(50, 52)">
        <ellipse cx="0" cy="-28" rx="20" ry="24" fill="#22c55e" />
        <ellipse
          cx="0"
          cy="-28"
          rx="20"
          ry="24"
          fill="#16a34a"
          transform="rotate(90)"
        />
        <ellipse
          cx="0"
          cy="-28"
          rx="20"
          ry="24"
          fill="#22c55e"
          transform="rotate(180)"
        />
        <ellipse
          cx="0"
          cy="-28"
          rx="20"
          ry="24"
          fill="#16a34a"
          transform="rotate(270)"
        />
        <ellipse cx="0" cy="-26" rx="12" ry="15" fill="#4ade80" />
        <ellipse
          cx="0"
          cy="-26"
          rx="12"
          ry="15"
          fill="#4ade80"
          transform="rotate(90)"
        />
        <ellipse
          cx="0"
          cy="-26"
          rx="12"
          ry="15"
          fill="#4ade80"
          transform="rotate(180)"
        />
        <ellipse
          cx="0"
          cy="-26"
          rx="12"
          ry="15"
          fill="#4ade80"
          transform="rotate(270)"
        />
        <circle cx="0" cy="0" r="14" fill="#bbf7d0" />
        <circle cx="0" cy="0" r="8" fill="#4ade80" />
        <path
          d="M0,14 Q5,28 3,40"
          fill="none"
          stroke="#15803d"
          strokeWidth="3"
          strokeLinecap="round"
        />
      </g>
    </svg>
  );
}

export default function AppShell({ children }) {
  const { user, signOut } = useAuth();
  const { pathname } = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="min-h-screen bg-gray-50 lg:flex">
      <aside className="hidden lg:flex lg:w-60 lg:flex-none lg:flex-col lg:border-r lg:border-gray-200 lg:bg-white">
        <Link
          to="/dashboard"
          className="flex items-center gap-2 px-6 py-5 text-lg text-gray-900"
        >
          <CloverLogo className="h-9 w-9 flex-none" />
          <span className="font-medium">TuitionPayLah</span>
        </Link>
        <nav className="flex flex-1 flex-col gap-1 px-3">
          {NAV_ITEMS.map((item) => {
            const active = pathname.startsWith(item.to);
            return (
              <Link
                key={item.to}
                to={item.to}
                className={
                  active
                    ? "flex items-center gap-3 rounded-md bg-green-50 px-3 py-2.5 text-sm font-medium text-green-700"
                    : "flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium text-gray-600 transition hover:bg-gray-100 hover:text-gray-900"
                }
              >
                <NavIcon name={item.icon} className="h-5 w-5 flex-none" />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-gray-200 px-4 py-4">
          <p className="mb-2 truncate text-xs text-gray-500">{user?.email}</p>
          <button
            onClick={signOut}
            className="min-h-11 w-full rounded-md border border-gray-300 px-3 text-sm font-medium text-gray-700 transition hover:bg-gray-100"
          >
            Sign out
          </button>
        </div>
      </aside>

      <div className="flex-1">
        <header className="border-b border-gray-200 bg-white lg:hidden">
          <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3 sm:px-6">
            <Link
              to="/dashboard"
              className="flex items-center gap-2 text-lg text-gray-900"
            >
              <CloverLogo className="h-9 w-9 flex-none" />
              <span className="font-medium">TuitionPayLah</span>
            </Link>
            <button
              onClick={() => setMenuOpen((open) => !open)}
              className="flex h-11 w-11 items-center justify-center rounded-md border border-gray-300 text-gray-700"
              aria-label="Toggle menu"
              aria-expanded={menuOpen}
            >
              {menuOpen ? (
                <svg
                  className="h-6 w-6"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              ) : (
                <svg
                  className="h-6 w-6"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 6h16M4 12h16M4 18h16"
                  />
                </svg>
              )}
            </button>
          </div>

          {menuOpen && (
            <nav className="border-t border-gray-200 bg-white px-4 py-3">
              <div className="flex flex-col gap-1">
                {NAV_ITEMS.map((item) => {
                  const active = pathname.startsWith(item.to);
                  return (
                    <Link
                      key={item.to}
                      to={item.to}
                      onClick={() => setMenuOpen(false)}
                      className={
                        active
                          ? "flex min-h-11 items-center gap-3 rounded-md bg-green-50 px-3 py-2.5 text-sm font-medium text-green-600"
                          : "flex min-h-11 items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-50"
                      }
                    >
                      <NavIcon name={item.icon} className="h-5 w-5 flex-none" />
                      {item.label}
                    </Link>
                  );
                })}
              </div>
              <div className="mt-3 flex items-center justify-between border-t border-gray-200 pt-3">
                <span className="text-sm text-gray-500">{user?.email}</span>
                <button
                  onClick={signOut}
                  className="min-h-11 rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100"
                >
                  Sign out
                </button>
              </div>
            </nav>
          )}
        </header>

        <main className="mx-auto max-w-[1200px] space-y-8 px-4 py-6 sm:px-6 sm:py-8 lg:px-10 lg:py-10">
          {children}
        </main>
      </div>
    </div>
  );
}
