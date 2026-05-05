"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { authApi } from "@/lib/api";

export default function LoginPage() {
  const [loading, setLoading] = useState(false);

  const login = async () => {
    setLoading(true);
    try {
      const res = await authApi.loginUrl();
      window.location.href = res.data.auth_url;
    } catch {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-semibold text-gray-900">deep-hire</h1>
          <p className="mt-1 text-sm text-gray-400">Resume Matcher Platform</p>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-8 shadow-sm">
          <p className="mb-6 text-sm text-gray-500 text-center">
            Sign in with your HH.uz employer account to get started.
          </p>
          <Button className="w-full" onClick={login} disabled={loading}>
            {loading ? (
              <span className="flex items-center gap-2">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                Redirecting...
              </span>
            ) : (
              "Login with HH.uz"
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
