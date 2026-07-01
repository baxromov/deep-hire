"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { Briefcase, Users, Plug, ShieldCheck, LogOut } from "lucide-react";
import { useAuth } from "@/lib/auth-context";

function IpotekaBankIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Ipoteka Bank logo: circular leaf/sprout mark */}
      <circle cx="16" cy="16" r="14" fill="white" fillOpacity="0.15"/>
      <path
        d="M16 6C16 6 8 10 8 18C8 22.4 11.6 26 16 26C20.4 26 24 22.4 24 18C24 10 16 6 16 6Z"
        fill="white"
        fillOpacity="0.9"
      />
      <path
        d="M16 14V26"
        stroke="#00A651"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path
        d="M16 20C16 20 13 17 13 14"
        stroke="#00A651"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

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
      <div className="flex items-center gap-3 px-4 h-16 border-b border-slate-800">
        <div className="h-8 w-8 rounded-lg bg-green-600 flex items-center justify-center shrink-0">
          <IpotekaBankIcon className="h-5 w-5" />
        </div>
        <div className="leading-tight min-w-0">
          <p className="text-sm font-bold text-white truncate">Ipoteka Bank</p>
          <p className="text-[10px] text-slate-500 tracking-wide uppercase">OTP Group</p>
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
                  ? "bg-green-600 text-white"
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
                  ? "bg-green-600 text-white"
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
          <div className="h-8 w-8 rounded-full bg-green-600/20 border border-green-500/40 flex items-center justify-center shrink-0">
            <span className="text-xs font-semibold text-green-300">{initials}</span>
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
