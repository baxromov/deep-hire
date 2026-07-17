"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { LayoutDashboard, Briefcase, Users, ShieldCheck, LogOut, ChevronLeft, ChevronRight } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useLocale } from "@/lib/i18n/context";
import { LOCALES, LOCALE_LABELS } from "@/lib/i18n";

const COLLAPSE_KEY = "dh_sidebar_collapsed";

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, loading, logout } = useAuth();
  const { locale, setLocale, t } = useLocale();
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    setCollapsed(localStorage.getItem(COLLAPSE_KEY) === "1");
  }, []);

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
      return next;
    });
  };

  const NAV_LINKS = [
    { href: "/dashboard",  label: t("nav.dashboard"),  icon: LayoutDashboard },
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
    <aside
      className={`relative shrink-0 h-screen sticky top-0 bg-white border-r border-gray-200 transition-[width] duration-200 ${
        collapsed ? "w-[68px]" : "w-56"
      }`}
    >
      {/* Collapse/expand toggle — sibling of the scrollable/clipped content below, so it's never cut off */}
      <button
        onClick={toggleCollapsed}
        title={collapsed ? t("nav.expandSidebar") : t("nav.collapseSidebar")}
        className="absolute -right-3 top-6 z-20 flex h-6 w-6 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-400 shadow-sm transition-colors hover:border-gray-300 hover:bg-gray-50 hover:text-gray-700"
      >
        {collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronLeft className="h-3.5 w-3.5" />}
      </button>

      <div className="flex h-full flex-col overflow-y-auto overflow-x-hidden">
      {/* Header: bank logo + app name */}
      <div className="flex flex-col justify-center gap-1 px-4 h-16 border-b border-gray-100">
        {collapsed ? (
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-green-600 text-xs font-bold text-white">
            IB
          </div>
        ) : (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/ipotekabank-logo.png"
              alt="Ipoteka Bank OTP Group"
              className="h-5 w-auto object-contain object-left"
            />
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest pl-0.5">
              Deep Hire
            </p>
          </>
        )}
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
              title={collapsed ? label : undefined}
              className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                collapsed ? "justify-center px-0" : ""
              } ${
                active
                  ? "bg-green-600 text-white"
                  : "text-gray-500 hover:bg-gray-50 hover:text-gray-900"
              }`}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {!collapsed && label}
            </Link>
          );
        })}

        <div className="my-3 border-t border-gray-100" />

        {user.role === "admin" && (() => {
          const active = pathname.startsWith("/admin");
          return (
            <Link
              href="/admin/users"
              title={collapsed ? t("nav.users") : undefined}
              className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                collapsed ? "justify-center px-0" : ""
              } ${
                active
                  ? "bg-green-600 text-white"
                  : "text-gray-500 hover:bg-gray-50 hover:text-gray-900"
              }`}
            >
              <ShieldCheck className="h-4 w-4 shrink-0" />
              {!collapsed && t("nav.users")}
            </Link>
          );
        })()}
      </nav>

      {/* User section */}
      <div className="border-t border-gray-100 p-3">
        {/* Language switcher */}
        {!collapsed && (
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
        )}

        <Link
          href="/profile"
          title={collapsed ? user.full_name || user.username : undefined}
          className={`flex items-center gap-3 rounded-lg px-2 py-2 mb-1 transition-colors ${
            collapsed ? "justify-center px-0" : ""
          } ${pathname === "/profile" ? "bg-green-50" : "hover:bg-gray-50"}`}
        >
          <div className="h-8 w-8 rounded-full bg-green-50 border border-green-200 flex items-center justify-center shrink-0">
            <span className="text-xs font-semibold text-green-700">{initials}</span>
          </div>
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-gray-900 truncate">
                {user.full_name || user.username}
              </p>
              <p className="text-xs text-gray-400 truncate">
                {user.role === "admin" ? t("nav.admin") : t("nav.staff")}
              </p>
            </div>
          )}
        </Link>
        <button
          onClick={handleLogout}
          title={collapsed ? t("nav.logout") : undefined}
          className={`flex items-center gap-2 w-full rounded-lg px-3 py-2 text-sm font-medium text-gray-400 hover:bg-gray-50 hover:text-gray-700 transition-colors ${
            collapsed ? "justify-center px-0" : ""
          }`}
        >
          <LogOut className="h-4 w-4 shrink-0" />
          {!collapsed && t("nav.logout")}
        </button>
      </div>
      </div>
    </aside>
  );
}
