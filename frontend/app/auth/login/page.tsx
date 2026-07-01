"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function IpotekaBankLogo({ size = 40 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="20" cy="20" r="18" fill="#00A651"/>
      <circle cx="20" cy="20" r="14" fill="white" fillOpacity="0.15"/>
      <path
        d="M20 8C20 8 11 13 11 22C11 27.5 15 32 20 32C25 32 29 27.5 29 22C29 13 20 8 20 8Z"
        fill="white"
        fillOpacity="0.95"
      />
      <path d="M20 18V32" stroke="#00A651" strokeWidth="1.8" strokeLinecap="round"/>
      <path d="M20 25C20 25 16.5 21 16.5 17.5" stroke="#00A651" strokeWidth="1.4" strokeLinecap="round"/>
    </svg>
  );
}

export default function LoginPage() {
  const router = useRouter();
  const { login } = useAuth();

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
      router.replace("/vacancies");
    } catch {
      setError("Неверный логин или пароль");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen bg-slate-950">
      {/* Left brand panel */}
      <div className="hidden lg:flex w-[420px] shrink-0 flex-col justify-between bg-gradient-to-br from-green-700 to-green-900 p-10 relative overflow-hidden">
        {/* subtle pattern */}
        <div className="absolute inset-0 opacity-5" style={{backgroundImage:"radial-gradient(circle at 1px 1px, white 1px, transparent 0)", backgroundSize:"24px 24px"}} />

        <div className="relative flex items-center gap-3">
          <IpotekaBankLogo size={44} />
          <div>
            <p className="text-white font-bold text-base leading-tight">Ipoteka Bank</p>
            <p className="text-green-200 text-xs tracking-widest uppercase">OTP Group</p>
          </div>
        </div>

        <div className="relative">
          <p className="text-white/40 text-xs font-semibold uppercase tracking-widest mb-4">Кадровая платформа</p>
          <blockquote className="text-white text-2xl font-semibold leading-snug mb-4">
            Подбор кадров для&nbsp;лидера ипотечного рынка
          </blockquote>
          <p className="text-green-200/70 text-sm leading-relaxed">
            Внутренняя платформа управления вакансиями и&nbsp;кандидатами с&nbsp;AI-ранжированием резюме.
          </p>
        </div>

        <div className="relative flex flex-wrap gap-2">
          {["AI Scoring", "HH интеграция", "Excel импорт", "On-premise"].map((tag) => (
            <span key={tag} className="rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs text-white/70">
              {tag}
            </span>
          ))}
        </div>
      </div>

      {/* Right form panel */}
      <div className="flex flex-1 items-center justify-center px-6">
        <div className="w-full max-w-sm">
          <div className="mb-8">
            {/* Mobile logo */}
            <div className="mb-4 flex items-center gap-2.5 lg:hidden">
              <IpotekaBankLogo size={36} />
              <div>
                <p className="text-white font-bold text-sm">Ipoteka Bank</p>
                <p className="text-slate-500 text-[10px] uppercase tracking-wide">OTP Group</p>
              </div>
            </div>
            <h1 className="text-2xl font-bold text-white">Добро пожаловать</h1>
            <p className="mt-1 text-sm text-slate-400">Войдите в корпоративный аккаунт</p>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-8 shadow-xl">
            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="space-y-1.5">
                <Label htmlFor="username" className="text-slate-300 text-sm font-medium">
                  Логин
                </Label>
                <Input
                  id="username"
                  type="text"
                  autoComplete="username"
                  placeholder="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                  className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500 focus:border-green-500 focus:ring-green-500/20 h-11"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="password" className="text-slate-300 text-sm font-medium">
                  Пароль
                </Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500 focus:border-green-500 focus:ring-green-500/20 h-11"
                />
              </div>

              {error && (
                <div className="rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2.5">
                  <p className="text-sm text-red-400 text-center">{error}</p>
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full h-11 rounded-lg bg-green-600 hover:bg-green-500 text-white font-semibold text-sm transition-colors disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                    Вход...
                  </>
                ) : (
                  "Войти"
                )}
              </button>
            </form>
          </div>

          <p className="mt-6 text-center text-xs text-slate-600">
            © {new Date().getFullYear()} Ipoteka Bank OTP Group. Все права защищены.
          </p>
        </div>
      </div>
    </div>
  );
}
