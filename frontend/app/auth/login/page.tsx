"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, Link2, FileSpreadsheet, ShieldCheck, Lock } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useLocale } from "@/lib/i18n/context";
import { LOCALES, LOCALE_LABELS } from "@/lib/i18n";

export default function LoginPage() {
  const router = useRouter();
  const { login } = useAuth();
  const { locale, setLocale, t } = useLocale();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login(username, password);
      router.replace("/dashboard");
    } catch {
      setError(t("authLogin.invalidCredentials"));
    } finally {
      setLoading(false);
    }
  };

  const TAGS = [
    { icon: Sparkles, label: t("authLogin.tagAiScoring") },
    { icon: Link2, label: t("authLogin.tagHhIntegration") },
    { icon: FileSpreadsheet, label: t("authLogin.tagExcelImport") },
    { icon: ShieldCheck, label: t("authLogin.tagOnPremise") },
  ];

  return (
    <div className="-mx-8 -my-8 flex h-screen overflow-hidden bg-gray-50 relative">
      {/* Language switcher */}
      <div className="absolute top-4 right-4 z-10 flex gap-0.5 rounded-lg bg-white border border-gray-200 p-0.5 shadow-sm">
        {LOCALES.map((l) => (
          <button
            key={l}
            onClick={() => setLocale(l)}
            className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors ${
              locale === l ? "bg-green-600 text-white" : "text-gray-400 hover:text-gray-600"
            }`}
          >
            {LOCALE_LABELS[l]}
          </button>
        ))}
      </div>

      {/* Left brand panel — green gradient bank identity, with animated glow orbs */}
      <div className="hidden lg:flex w-[440px] shrink-0 flex-col justify-between bg-gradient-to-br from-green-600 via-emerald-600 to-green-800 p-10 relative overflow-hidden">
        <div className="absolute inset-0 opacity-[0.07]"
          style={{ backgroundImage: "radial-gradient(circle at 1px 1px, white 1px, transparent 0)", backgroundSize: "24px 24px" }}
        />
        <div className="pointer-events-none absolute -top-24 -right-16 h-72 w-72 rounded-full bg-white/10 blur-3xl animate-[pulse_7s_ease-in-out_infinite]" />
        <div className="pointer-events-none absolute top-1/3 -left-24 h-64 w-64 rounded-full bg-teal-300/10 blur-3xl animate-[pulse_9s_ease-in-out_infinite]" style={{ animationDelay: "1.5s" }} />
        <div className="pointer-events-none absolute -bottom-28 right-10 h-72 w-72 rounded-full bg-white/10 blur-3xl animate-[pulse_8s_ease-in-out_infinite]" style={{ animationDelay: "3s" }} />

        {/* Bank logo — white filter so it shows on green bg */}
        <div className="relative animate-in fade-in-0 slide-in-from-left-4 duration-700">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/ipotekabank-logo.png"
            alt="Ipoteka Bank OTP Group"
            className="h-8 w-auto object-contain object-left"
            style={{ filter: "brightness(0) invert(1)" }}
          />
        </div>

        <div className="relative animate-in fade-in-0 slide-in-from-left-4 duration-700" style={{ animationDelay: "100ms", animationFillMode: "backwards" }}>
          <p className="text-green-300 text-xs font-semibold uppercase tracking-widest mb-3">
            {t("authLogin.eyebrow")}
          </p>
          <h2 className="text-white text-2xl font-bold leading-snug mb-4">
            {t("authLogin.heroTitle")}
          </h2>
          <p className="text-green-100/70 text-sm leading-relaxed">
            {t("authLogin.heroDescription")}
          </p>
        </div>

        <div className="relative flex flex-wrap gap-2 animate-in fade-in-0 slide-in-from-left-4 duration-700" style={{ animationDelay: "200ms", animationFillMode: "backwards" }}>
          {TAGS.map(({ icon: Icon, label }) => (
            <span key={label} className="flex items-center gap-1.5 rounded-full border border-white/25 bg-white/10 px-3 py-1 text-xs text-white/80 backdrop-blur-sm transition-colors hover:bg-white/15">
              <Icon className="h-3 w-3" />
              {label}
            </span>
          ))}
        </div>
      </div>

      {/* Right form panel — light, vertically centered, no scroll */}
      <div className="flex flex-1 items-center justify-center px-8 overflow-hidden">
        <div className="w-full max-w-sm animate-in fade-in-0 slide-in-from-bottom-4 duration-700">

          {/* Mobile: show bank logo */}
          <div className="mb-6 lg:hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/ipotekabank-logo.png"
              alt="Ipoteka Bank OTP Group"
              className="h-6 w-auto object-contain object-left"
            />
          </div>

          <div className="mb-8 flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-green-50 border border-green-200 text-green-600 shadow-sm">
              <Lock className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900">{t("authLogin.welcomeBack")}</h1>
              <p className="text-sm text-gray-500">{t("authLogin.subtitle")}</p>
            </div>
          </div>

          <div className="rounded-2xl border border-gray-200 bg-white p-8 shadow-lg shadow-gray-200/50 transition-shadow hover:shadow-xl">
            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="space-y-1.5">
                <Label htmlFor="username" className="text-gray-700 text-sm font-medium">
                  {t("authLogin.username")}
                </Label>
                <Input
                  id="username"
                  type="text"
                  autoComplete="username"
                  placeholder="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                  className="h-11 border-gray-300 focus:border-green-500 focus:ring-green-500/20"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="password" className="text-gray-700 text-sm font-medium">
                  {t("authLogin.password")}
                </Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="h-11 border-gray-300 focus:border-green-500 focus:ring-green-500/20"
                />
              </div>

              {error && (
                <div className="animate-in fade-in-0 slide-in-from-top-1 rounded-lg bg-red-50 border border-red-200 px-3 py-2.5 duration-300">
                  <p className="text-sm text-red-600 text-center">{error}</p>
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="group relative w-full h-11 overflow-hidden rounded-lg bg-green-600 hover:bg-green-700 text-white font-semibold text-sm transition-all disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-sm hover:shadow-md active:scale-[0.99]"
              >
                <span className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/20 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
                {loading ? (
                  <>
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                    {t("authLogin.submitting")}
                  </>
                ) : (
                  t("authLogin.submit")
                )}
              </button>
            </form>
          </div>

          <p className="mt-6 text-center text-xs text-gray-400">
            © {new Date().getFullYear()} Ipoteka Bank OTP Group. {t("authLogin.footer")}
          </p>
        </div>
      </div>
    </div>
  );
}
