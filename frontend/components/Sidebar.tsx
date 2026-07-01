"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { Briefcase, Users, Plug, ShieldCheck, LogOut } from "lucide-react";
import { useAuth } from "@/lib/auth-context";

const NAV_LINKS = [
  { href: "/vacancies",  label: "Вакансии",   icon: Briefcase },
  { href: "/candidates", label: "Кандидаты",  icon: Users },
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
    <aside className="w-56 shrink-0 flex flex-col bg-slate-900 min-h-screen">
      {/* Logo */}
      <div className="flex items-center gap-2.5 px-5 h-16 border-b border-slate-800">
        <div className="h-7 w-7 rounded-lg bg-indigo-500 flex items-center justify-center shrink-0">
          <span className="text-white text-xs font-bold">DH</span>
        </div>
        <span className="text-sm font-semibold text-white tracking-tight">
          Deep<span className="text-indigo-400">Hire</span>
        </span>
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
                  ? "bg-indigo-600 text-white"
                  : "text-slate-400 hover:bg-slate-800 hover:text-slate-100"
              }`}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {label}
            </Link>
          );
        })}

        <div className="my-3 border-t border-slate-800" />

        {(() => {
          const active = pathname.startsWith("/settings");
          return (
            <Link
              href="/settings/integrations"
              className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                active
                  ? "bg-indigo-600 text-white"
                  : "text-slate-400 hover:bg-slate-800 hover:text-slate-100"
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
                  ? "bg-indigo-600 text-white"
                  : "text-slate-400 hover:bg-slate-800 hover:text-slate-100"
              }`}
            >
              <ShieldCheck className="h-4 w-4 shrink-0" />
              Пользователи
            </Link>
          );
        })()}
      </nav>

      {/* User */}
      <div className="border-t border-slate-800 p-3">
        <div className="flex items-center gap-3 rounded-lg px-2 py-2 mb-1">
          <div className="h-8 w-8 rounded-full bg-indigo-500/20 border border-indigo-500/40 flex items-center justify-center shrink-0">
            <span className="text-xs font-semibold text-indigo-300">{initials}</span>
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-slate-200 truncate">
              {user.full_name || user.username}
            </p>
            <p className="text-xs text-slate-500 truncate">
              {user.role === "admin" ? "Администратор" : "Сотрудник"}
            </p>
          </div>
        </div>
        <button
          onClick={handleLogout}
          className="flex items-center gap-2 w-full rounded-lg px-3 py-2 text-sm font-medium text-slate-500 hover:bg-slate-800 hover:text-slate-300 transition-colors"
        >
          <LogOut className="h-4 w-4 shrink-0" />
          Выйти
        </button>
      </div>
    </aside>
  );
}
