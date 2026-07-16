"use client";

import { Suspense } from "react";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { integrationApi } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/lib/i18n/context";
import { SkeletonLine } from "@/components/ui/skeleton";

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

// useSearchParams() must be inside a <Suspense> boundary in Next.js 15+
function IntegrationsContent() {
  const { t } = useLocale();
  const searchParams = useSearchParams();
  const [accounts, setAccounts] = useState<HHAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);

  const load = async () => {
    try {
      const res = await integrationApi.listHH();
      setAccounts(res.data);
    } catch {
      toast.error(t("integrations.loadError"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // Show toast if redirected back from HH OAuth
    if (searchParams.get("connected") === "1") {
      toast.success(t("integrations.connectedSuccess"));
    }
    if (searchParams.get("error")) {
      toast.error(t("integrations.connectError"));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const handleConnect = async () => {
    setConnecting(true);
    try {
      const res = await integrationApi.getHHConnectUrl();
      window.location.href = res.data.auth_url;
    } catch {
      toast.error(t("integrations.authUrlError"));
      setConnecting(false);
    }
  };

  const handleDisconnect = async (id: string, name: string) => {
    if (!confirm(t("integrations.disconnectConfirm", { name }))) return;
    try {
      await integrationApi.disconnectHH(id);
      toast.success(t("integrations.disconnectSuccess"));
      setAccounts((prev) => prev.filter((a) => a.id !== id));
    } catch {
      toast.error(t("integrations.disconnectError"));
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">{t("integrations.title")}</h1>
        <p className="text-sm text-gray-500 mt-1">{t("integrations.subtitle")}</p>
      </div>

      {/* HH.uz section */}
      <div className="rounded-xl border border-gray-200 bg-white p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">HH.uz</h2>
            <p className="text-xs text-gray-400 mt-0.5">{t("integrations.hhDescription")}</p>
          </div>
          <Button size="sm" onClick={handleConnect} disabled={connecting}>
            {connecting ? (
              <span className="flex items-center gap-1.5">
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                {t("integrations.connecting")}
              </span>
            ) : (
              t("integrations.addAccount")
            )}
          </Button>
        </div>

        {loading ? (
          <ul className="divide-y divide-gray-100">
            {Array.from({ length: 3 }).map((_, i) => (
              <li key={i} className="flex items-center justify-between py-3">
                <div className="space-y-1.5">
                  <SkeletonLine className="h-4 w-40" />
                  <SkeletonLine className="h-3 w-28" />
                </div>
              </li>
            ))}
          </ul>
        ) : accounts.length === 0 ? (
          <div className="rounded-lg border border-dashed border-gray-200 py-8 text-center">
            <p className="text-sm text-gray-400">{t("integrations.noAccounts")}</p>
            <p className="text-xs text-gray-300 mt-1">{t("integrations.noAccountsHint")}</p>
          </div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {accounts.map((acc) => (
              <li key={acc.id} className="flex items-center justify-between py-3">
                <div className="space-y-0.5">
                  <p className="text-sm font-medium text-gray-900">
                    {acc.employer_name || acc.hh_user_name || t("common.none")}
                  </p>
                  {acc.email && (
                    <p className="text-xs text-gray-400">{acc.email}</p>
                  )}
                  {acc.employer_id && (
                    <p className="text-xs text-gray-300">
                      {t("integrations.employerLabel", { id: acc.employer_id })}
                    </p>
                  )}
                </div>
                <button
                  onClick={() =>
                    handleDisconnect(acc.id, acc.employer_name || acc.hh_user_name)
                  }
                  className="text-xs text-red-400 hover:text-red-600 transition-colors"
                >
                  {t("integrations.disconnect")}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// Wrap with Suspense — required by Next.js 15+ for useSearchParams()
export default function IntegrationsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex justify-center pt-20">
          <span className="h-6 w-6 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
        </div>
      }
    >
      <IntegrationsContent />
    </Suspense>
  );
}
