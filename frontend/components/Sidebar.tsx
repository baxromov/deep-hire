"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { authApi } from "@/lib/api";



interface Profile {
  id: string;
  name: string;
  email: string;
  employer_name: string;
}

const NAV_LINKS = [
  { href: "/vacancies", label: "Vacancies" },
  { href: "/candidates", label: "Candidates" },
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);

  useEffect(() => {
    if (pathname.startsWith("/auth")) return;
    authApi.me()
      .then((res) => setProfile(res.data))
      .catch(() => router.replace("/auth/login"));
  }, [pathname, router]);

  if (pathname.startsWith("/auth")) return null;

  const logout = async () => {
    await authApi.logout().catch(() => {});
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
      </nav>

      <div className="border-t border-gray-100 pt-4 mt-4 space-y-3">
        {profile && (
          <Link
            href="/profile"
            className="block rounded-lg px-3 py-2 hover:bg-gray-50 transition-colors space-y-0.5"
          >
            <p className="text-sm font-medium text-gray-900 truncate">{profile.name}</p>
            {profile.email && (
              <p className="text-xs text-gray-400 truncate">{profile.email}</p>
            )}
            {profile.employer_name && (
              <p className="text-xs text-gray-400 truncate">{profile.employer_name}</p>
            )}
          </Link>
        )}
        <button
          onClick={logout}
          className="w-full rounded-lg px-3 py-2 text-left text-sm font-medium text-gray-400 hover:bg-gray-50 hover:text-gray-900 transition-colors"
        >
          Logout
        </button>
      </div>
    </aside>
  );
}
