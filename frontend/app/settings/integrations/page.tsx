"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { integrationApi } from "@/lib/api";
import { Button } from "@/components/ui/button";

interface HHAccount {
  id: string;
  label: string;
  hh_user_id: string;
  hh_user_name: string;
  email: string;
  employer_id: string;
  employer_name: string;
  is_employer: boolean;
}

export default function IntegrationsPage() {
  const searchParams = useSearchParams();
  const [accounts, setAccounts] = useState<HHAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);

  const load = async () => {
    try {
      const res = await integrationApi.listHH();
      setAccounts(res.data);
    } catch {
      toast.error("Не удалось загрузить аккаунты");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // Show toast if redirected back from HH OAuth
    if (searchParams.get("connected") === "1") {
      toast.success("HH аккаунт успешно подключён");
    }
    if (searchParams.get("error")) {
      toast.error("Не удалось подключить HH аккаунт");
    }
  }, [searchParams]);

  const handleConnect = async () => {
    setConnecting(true);
    try {
      const res = await integrationApi.getHHConnectUrl();
      window.location.href = res.data.auth_url;
    } catch {
      toast.error("Не удалось получить ссылку авторизации");
      setConnecting(false);
    }
  };

  const handleDisconnect = async (id: string, name: string) => {
    if (!confirm(`Отключить аккаунт "${name}"?`)) return;
    try {
      await integrationApi.disconnectHH(id);
      toast.success("Аккаунт отключён");
      setAccounts((prev) => prev.filter((a) => a.id !== id));
    } catch {
      toast.error("Не удалось отключить аккаунт");
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Интеграции</h1>
        <p className="text-sm text-gray-500 mt-1">
          Подключите один или несколько аккаунтов HH.uz для поиска резюме.
        </p>
      </div>

      {/* HH.uz section */}
      <div className="rounded-xl border border-gray-200 bg-white p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">HH.uz</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              Аккаунты работодателя для поиска кандидатов
            </p>
          </div>
          <Button size="sm" onClick={handleConnect} disabled={connecting}>
            {connecting ? (
              <span className="flex items-center gap-1.5">
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                Подключение...
              </span>
            ) : (
              "+ Добавить аккаунт"
            )}
          </Button>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 py-4 text-sm text-gray-400">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-transparent" />
            Загрузка...
          </div>
        ) : accounts.length === 0 ? (
          <div className="rounded-lg border border-dashed border-gray-200 py-8 text-center">
            <p className="text-sm text-gray-400">Нет подключённых аккаунтов</p>
            <p className="text-xs text-gray-300 mt-1">
              Нажмите «Добавить аккаунт», чтобы подключить HH.uz
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {accounts.map((acc) => (
              <li key={acc.id} className="flex items-center justify-between py-3">
                <div className="space-y-0.5">
                  <p className="text-sm font-medium text-gray-900">
                    {acc.employer_name || acc.hh_user_name || "—"}
                  </p>
                  {acc.email && (
                    <p className="text-xs text-gray-400">{acc.email}</p>
                  )}
                  {acc.employer_id && (
                    <p className="text-xs text-gray-300">
                      Работодатель #{acc.employer_id}
                    </p>
                  )}
                </div>
                <button
                  onClick={() =>
                    handleDisconnect(acc.id, acc.employer_name || acc.hh_user_name)
                  }
                  className="text-xs text-red-400 hover:text-red-600 transition-colors"
                >
                  Отключить
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
