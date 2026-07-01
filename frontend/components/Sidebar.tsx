"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { Briefcase, Users, Plug, ShieldCheck, LogOut } from "lucide-react";
import { useAuth } from "@/lib/auth-context";

const NAV_LINKS = [
  { href: "/vacancies",  label: "Вакансии",  icon: Briefcase },
  { href: "/candidates", label: "Кандидаты", icon: Users },
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, loading, logout } = useAuth();

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

  const initials = (user.full_name || user.username || "?")
    .split(" ")
    .map((w: string) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <aside className="w-56 shrink-0 flex flex-col bg-white border-r border-gray-200 min-h-screen">
      {/* Header: bank logo + app name */}
      <div className="flex flex-col justify-center gap-1 px-4 h-16 border-b border-gray-100">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/ipotekabank-logo.png"
          alt="Ipoteka Bank OTP Group"
          className="h-5 w-auto object-contain object-left"
        />
        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest pl-0.5">
          Deep Hire
        </p>
      </div>

      {/* Nav */}
      <nav className="flex flex-col gap-0.5 flex-1 px-3 pt-4">
        {NAV_LINKS.map(({ href, label, icon: Icon }) => {
          const active = pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                active
                  ? "bg-green-600 text-white"
                  : "text-gray-500 hover:bg-gray-50 hover:text-gray-900"
              }`}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {label}
            </Link>
          );
        })}

        <div className="my-3 border-t border-gray-100" />

        {(() => {
          const active = pathname.startsWith("/settings");
          return (
            <Link
              href="/settings/integrations"
              className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                active
                  ? "bg-green-600 text-white"
                  : "text-gray-500 hover:bg-gray-50 hover:text-gray-900"
              }`}
            >
              <Plug className="h-4 w-4 shrink-0" />
              Интеграции
            </Link>
          );
        })()}

        {user.role === "admin" && (() => {
          const active = pathname.startsWith("/admin");
          return (
            <Link
              href="/admin/users"
              className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                active
                  ? "bg-green-600 text-white"
                  : "text-gray-500 hover:bg-gray-50 hover:text-gray-900"
              }`}
            >
              <ShieldCheck className="h-4 w-4 shrink-0" />
              Пользователи
            </Link>
          );
        })()}
      </nav>

      {/* User section */}
      <div className="border-t border-gray-100 p-3">
        <div className="flex items-center gap-3 px-2 py-2 mb-1">
          <div className="h-8 w-8 rounded-full bg-green-50 border border-green-200 flex items-center justify-center shrink-0">
            <span className="text-xs font-semibold text-green-700">{initials}</span>
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-gray-900 truncate">
              {user.full_name || user.username}
            </p>
            <p className="text-xs text-gray-400 truncate">
              {user.role === "admin" ? "Администратор" : "Сотрудник"}
            </p>
          </div>
        </div>
        <button
          onClick={handleLogout}
          className="flex items-center gap-2 w-full rounded-lg px-3 py-2 text-sm font-medium text-gray-400 hover:bg-gray-50 hover:text-gray-700 transition-colors"
        >
          <LogOut className="h-4 w-4 shrink-0" />
          Выйти
        </button>
      </div>
    </aside>
  );
}
