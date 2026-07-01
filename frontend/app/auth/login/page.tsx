"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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
    <div className="flex h-screen overflow-hidden bg-gray-50">
      {/* Left brand panel – green gradient stays as bank identity */}
      <div className="hidden lg:flex w-[400px] shrink-0 flex-col justify-between bg-gradient-to-br from-green-600 to-green-800 p-10 relative overflow-hidden">
        <div className="absolute inset-0 opacity-[0.07]"
          style={{ backgroundImage: "radial-gradient(circle at 1px 1px, white 1px, transparent 0)", backgroundSize: "24px 24px" }}
        />

        {/* Bank logo – white filter so it shows on green bg */}
        <div className="relative">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/ipotekabank-logo.png"
            alt="Ipoteka Bank OTP Group"
            className="h-8 w-auto object-contain object-left"
            style={{ filter: "brightness(0) invert(1)" }}
          />
        </div>

        <div className="relative">
          <p className="text-green-300 text-xs font-semibold uppercase tracking-widest mb-3">
            Кадровая платформа
          </p>
          <h2 className="text-white text-2xl font-bold leading-snug mb-4">
            Находите лучших специалистов быстрее и точнее
          </h2>
          <p className="text-green-100/70 text-sm leading-relaxed">
            Внутренняя платформа управления вакансиями и&nbsp;кандидатами с&nbsp;AI-ранжированием резюме.
          </p>
        </div>

        <div className="relative flex flex-wrap gap-2">
          {["AI Scoring", "HH интеграция", "Excel импорт", "On-premise"].map((tag) => (
            <span key={tag} className="rounded-full border border-white/25 bg-white/10 px-3 py-1 text-xs text-white/75">
              {tag}
            </span>
          ))}
        </div>
      </div>

      {/* Right form panel – light, vertically centered, no scroll */}
      <div className="flex flex-1 items-center justify-center px-8 overflow-hidden">
        <div className="w-full max-w-sm">

          {/* Mobile: show bank logo */}
          <div className="mb-6 lg:hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/ipotekabank-logo.png"
              alt="Ipoteka Bank OTP Group"
              className="h-6 w-auto object-contain object-left"
            />
          </div>

          <div className="mb-8">
            <h1 className="text-2xl font-bold text-gray-900">
              Deep <span className="text-green-600">Hire</span>
            </h1>
            <p className="mt-1 text-sm text-gray-500">Войдите в корпоративный аккаунт</p>
          </div>

          <div className="rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">
            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="space-y-1.5">
                <Label htmlFor="username" className="text-gray-700 text-sm font-medium">
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
                  className="h-11 border-gray-300 focus:border-green-500 focus:ring-green-500/20"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="password" className="text-gray-700 text-sm font-medium">
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
                  className="h-11 border-gray-300 focus:border-green-500 focus:ring-green-500/20"
                />
              </div>

              {error && (
                <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2.5">
                  <p className="text-sm text-red-600 text-center">{error}</p>
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full h-11 rounded-lg bg-green-600 hover:bg-green-700 text-white font-semibold text-sm transition-colors disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-sm"
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

          <p className="mt-6 text-center text-xs text-gray-400">
            © {new Date().getFullYear()} Ipoteka Bank OTP Group. Все права защищены.
          </p>
        </div>
      </div>
    </div>
  );
}
