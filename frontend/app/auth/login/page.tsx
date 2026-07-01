"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
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
    <div className="flex min-h-screen bg-slate-950">
      {/* Left brand panel */}
      <div className="hidden lg:flex w-[420px] shrink-0 flex-col justify-between bg-gradient-to-br from-indigo-600 to-indigo-800 p-10">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-xl bg-white/20 flex items-center justify-center">
            <span className="text-white font-bold text-sm">DH</span>
          </div>
          <span className="text-white font-semibold text-lg">DeepHire</span>
        </div>
        <div>
          <blockquote className="text-white/90 text-xl font-medium leading-snug mb-4">
            "Умный подбор резюме — быстрее, точнее, эффективнее"
          </blockquote>
          <p className="text-indigo-200 text-sm">
            Платформа автоматического подбора кандидатов с&nbsp;AI-ранжированием
          </p>
        </div>
        <div className="flex gap-2">
          {["AI Scoring", "HH интеграция", "Excel import"].map((tag) => (
            <span key={tag} className="rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs text-white/80">
              {tag}
            </span>
          ))}
        </div>
      </div>

      {/* Right form panel */}
      <div className="flex flex-1 items-center justify-center px-6">
        <div className="w-full max-w-sm">
          <div className="mb-8">
            <div className="mb-2 flex items-center gap-2 lg:hidden">
              <div className="h-7 w-7 rounded-lg bg-indigo-500 flex items-center justify-center">
                <span className="text-white text-xs font-bold">DH</span>
              </div>
              <span className="text-white font-semibold">DeepHire</span>
            </div>
            <h1 className="text-2xl font-bold text-white">Добро пожаловать</h1>
            <p className="mt-1 text-sm text-slate-400">Войдите в свой аккаунт</p>
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
                  placeholder="admin"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                  className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500 focus:border-indigo-500 focus:ring-indigo-500/20 h-11"
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
                  className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500 focus:border-indigo-500 focus:ring-indigo-500/20 h-11"
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
                className="w-full h-11 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-sm transition-colors disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
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
        </div>
      </div>
    </div>
  );
}
