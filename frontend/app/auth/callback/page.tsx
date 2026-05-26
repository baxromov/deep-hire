"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Old HH OAuth callback route — no longer used for authentication.
 * HH OAuth is now only used for integration (see /settings/integrations).
 * The backend redirects integration callbacks directly to /settings/integrations.
 */
export default function AuthCallbackPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/auth/login");
  }, [router]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-500 border-t-transparent" />
    </div>
  );
}
