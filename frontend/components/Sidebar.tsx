"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";

const NAV_LINKS = [
  { href: "/vacancies", label: "Вакансии" },
  { href: "/candidates", label: "Кандидаты" },
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, loading, logout } = useAuth();

  // Redirect unauthenticated users away from protected pages
  useEffect(() => {
    if (loading) return;
    if (!user && !pathname.startsWith("/auth")) {
      router.replace("/auth/login");
    }
  }, [user, loading, pathname, router]);

  if (pathname.startsWith("/auth")) return null;
  if (loading || !user) return null;

  const handleLogout = () => {
    logout();
    router.replace("/auth/login");
  };

  return (
    <aside className="w-52 shrink-0 flex flex-col border-r border-gray-200 bg-white min-h-screen px-3 py-6">
      <div className="px-3 mb-8">
        <span className="text-base font-semibold tracking-tight text-gray-900">Deep</span>
        <span className="text-base font-semibold tracking-tight text-blue-600">Hire</span>
      </div>

      <nav className="flex flex-col gap-1 flex-1">
        {NAV_LINKS.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
              pathname.startsWith(link.href)
                ? "bg-gray-100 text-gray-900"
                : "text-gray-500 hover:bg-gray-50 hover:text-gray-900"
            }`}
          >
            {link.label}
          </Link>
        ))}

        {/* Divider */}
        <div className="my-2 border-t border-gray-100" />

        <Link
          href="/settings/integrations"
          className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
            pathname.startsWith("/settings")
              ? "bg-gray-100 text-gray-900"
              : "text-gray-500 hover:bg-gray-50 hover:text-gray-900"
          }`}
        >
          Интеграции
        </Link>

        {user.role === "admin" && (
          <Link
            href="/admin/users"
            className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
              pathname.startsWith("/admin")
                ? "bg-gray-100 text-gray-900"
                : "text-gray-500 hover:bg-gray-50 hover:text-gray-900"
            }`}
          >
            Пользователи
          </Link>
        )}
      </nav>

      <div className="border-t border-gray-100 pt-4 mt-4 space-y-3">
        <div className="rounded-lg px-3 py-2 space-y-0.5">
          <p className="text-sm font-medium text-gray-900 truncate">
            {user.full_name || user.username}
          </p>
          {user.email && (
            <p className="text-xs text-gray-400 truncate">{user.email}</p>
          )}
          <p className="text-xs text-gray-400">
            {user.role === "admin" ? "Администратор" : "Сотрудник"}
          </p>
        </div>
        <button
          onClick={handleLogout}
          className="w-full rounded-lg px-3 py-2 text-left text-sm font-medium text-gray-400 hover:bg-gray-50 hover:text-gray-900 transition-colors"
        >
          Выйти
        </button>
      </div>
    </aside>
  );
}
