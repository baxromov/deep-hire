"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { Briefcase, Users, Plug, ShieldCheck, LogOut } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useLocale } from "@/lib/i18n/context";
import { LOCALES, LOCALE_LABELS } from "@/lib/i18n";

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, loading, logout } = useAuth();
  const { locale, setLocale, t } = useLocale();

  const NAV_LINKS = [
    { href: "/vacancies",  label: t("nav.vacancies"),  icon: Briefcase },
    { href: "/candidates", label: t("nav.candidates"), icon: Users },
  ];

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
    <aside className="w-56 shrink-0 flex flex-col bg-white border-r border-gray-200 h-screen sticky top-0 overflow-y-auto">
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
          const active =
            pathname === href ||
            pathname.startsWith(`${href}/`) ||
            (href === "/vacancies" && pathname.startsWith("/vacancies-hh"));
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
              {t("nav.integrations")}
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
              {t("nav.users")}
            </Link>
          );
        })()}
      </nav>

      {/* User section */}
      <div className="border-t border-gray-100 p-3">
        {/* Language switcher */}
        <div className="mb-2 flex gap-0.5 rounded-lg bg-gray-100 p-0.5">
          {LOCALES.map((l) => (
            <button
              key={l}
              onClick={() => setLocale(l)}
              className={`flex-1 rounded-md py-1 text-[11px] font-semibold transition-colors ${
                locale === l ? "bg-white text-gray-900 shadow-sm" : "text-gray-400 hover:text-gray-600"
              }`}
            >
              {LOCALE_LABELS[l]}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-3 px-2 py-2 mb-1">
          <div className="h-8 w-8 rounded-full bg-green-50 border border-green-200 flex items-center justify-center shrink-0">
            <span className="text-xs font-semibold text-green-700">{initials}</span>
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-gray-900 truncate">
              {user.full_name || user.username}
            </p>
            <p className="text-xs text-gray-400 truncate">
              {user.role === "admin" ? t("nav.admin") : t("nav.staff")}
            </p>
          </div>
        </div>
        <button
          onClick={handleLogout}
          className="flex items-center gap-2 w-full rounded-lg px-3 py-2 text-sm font-medium text-gray-400 hover:bg-gray-50 hover:text-gray-700 transition-colors"
        >
          <LogOut className="h-4 w-4 shrink-0" />
          {t("nav.logout")}
        </button>
      </div>
    </aside>
  );
}
