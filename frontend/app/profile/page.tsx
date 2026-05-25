"use client";

import { authApi } from "@/lib/api";
import useSWR from "swr";

interface Profile {
  id: string;
  name: string;
  email: string;
  phone: string;
  is_employer: boolean;
  employer_id: string;
  employer_name: string;
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

  const initials = profile.name
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
            <p className="text-base font-semibold text-gray-900">{profile.name}</p>
            {profile.employer_name && (
              <p className="text-sm text-gray-400">{profile.employer_name}</p>
            )}
          </div>
        </div>

        <div>
          <Row label="HH ID" value={profile.id} />
          <Row label="Email" value={profile.email} />
          <Row label="Телефон" value={profile.phone} />
          <Row label="Работодатель" value={profile.is_employer ? "Да" : undefined} />
          <Row label="ID работодателя" value={profile.employer_id} />
        </div>
      </div>
    </div>
  );
}
