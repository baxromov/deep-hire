"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { Briefcase, Users, Plug, ShieldCheck, LogOut } from "lucide-react";
import { useAuth } from "@/lib/auth-context";

function IpotekaBankLogo({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="20" cy="20" r="20" fill="#00A651" />
      <path
        d="M20 8C20 8 11 13.5 11 22C11 27.5 15 32 20 32C25 32 29 27.5 29 22C29 13.5 20 8 20 8Z"
        fill="white"
      />
      <line x1="20" y1="19" x2="20" y2="32" stroke="#00A651" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M20 26C20 26 16.5 22 16.5 18.5" stroke="#00A651" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

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
      {/* Header: logo + app name */}
      <div className="flex items-center gap-3 px-4 h-16 border-b border-gray-100">
        <IpotekaBankLogo size={32} />
        <div className="leading-tight min-w-0">
          <p className="text-sm font-bold text-gray-900 truncate">Deep Hire</p>
          <p className="text-[10px] text-gray-400 truncate">Ipoteka Bank · OTP Group</p>
        </div>
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
