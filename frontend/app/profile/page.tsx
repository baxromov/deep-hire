"use client";

import { authApi } from "@/lib/api";
import useSWR from "swr";

interface Profile {
  id: string;
  username: string;
  email: string;
  role: "admin" | "staff";
  full_name: string;
  is_active: boolean;
}

function Row({ label, value }: { label: string; value?: string | boolean | null }) {
  if (!value) return null;
  return (
    <div className="flex items-start gap-4 py-3 border-b border-gray-100 last:border-0">
      <span className="w-36 shrink-0 text-sm text-gray-400">{label}</span>
      <span className="text-sm text-gray-900">{String(value)}</span>
    </div>
  );
}

export default function ProfilePage() {
  const { data: profile, isLoading } = useSWR<Profile>(
    "me",
    () => authApi.me().then((r) => r.data)
  );

  if (isLoading) {
    return (
      <div className="flex justify-center pt-20">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
      </div>
    );
  }

  if (!profile) return null;

  const displayName = profile.full_name || profile.username;
  const initials = displayName
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  return (
    <div className="max-w-xl">
      <h1 className="text-xl font-semibold text-gray-900 mb-6">Профиль</h1>

      <div className="rounded-xl border border-gray-200 bg-white p-6">
        <div className="flex items-center gap-4 mb-6">
          <div className="h-14 w-14 rounded-full bg-gray-100 flex items-center justify-center text-xl font-semibold text-gray-500">
            {initials}
          </div>
          <div>
            <p className="text-base font-semibold text-gray-900">{displayName}</p>
            <p className="text-sm text-gray-400">
              {profile.role === "admin" ? "Администратор" : "Сотрудник"}
            </p>
          </div>
        </div>

        <div>
          <Row label="Логин" value={profile.username} />
          <Row label="Email" value={profile.email} />
          <Row label="Роль" value={profile.role === "admin" ? "Администратор" : "Сотрудник"} />
          <Row label="Активен" value={profile.is_active ? "Да" : "Нет"} />
        </div>
      </div>
    </div>
  );
}
