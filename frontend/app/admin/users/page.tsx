"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth-context";
import { authApi } from "@/lib/api";
import { useLocale } from "@/lib/i18n/context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SkeletonTableRows } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface UserRow {
  id: string;
  username: string;
  email: string;
  role: string;
  full_name: string;
  is_active: boolean;
}

const EMPTY_FORM = {
  username: "",
  email: "",
  password: "",
  role: "staff",
  full_name: "",
};

export default function AdminUsersPage() {
  const router = useRouter();
  const { user: me, loading } = useAuth();
  const { t } = useLocale();

  const [users, setUsers] = useState<UserRow[]>([]);
  const [fetching, setFetching] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  // Guard: only admin
  useEffect(() => {
    if (loading) return;
    if (!me) { router.replace("/auth/login"); return; }
    if (me.role !== "admin") { router.replace("/vacancies"); return; }
  }, [me, loading, router]);

  const load = async () => {
    try {
      const res = await authApi.listUsers();
      setUsers(res.data);
    } catch {
      toast.error(t("admin.loadUsersError"));
    } finally {
      setFetching(false);
    }
  };

  useEffect(() => {
    if (me?.role === "admin") load();
  }, [me]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await authApi.createUser(form);
      setUsers((prev) => [...prev, res.data]);
      setForm(EMPTY_FORM);
      setShowForm(false);
      toast.success(t("admin.userCreated", { username: form.username }));
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
        t("admin.createUserError");
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (u: UserRow) => {
    try {
      await authApi.updateUser(u.id, { is_active: !u.is_active });
      setUsers((prev) =>
        prev.map((r) => (r.id === u.id ? { ...r, is_active: !u.is_active } : r))
      );
      toast.success(u.is_active ? t("admin.userDeactivated") : t("admin.userActivated"));
    } catch {
      toast.error(t("admin.updateUserError"));
    }
  };

  const handleDelete = async (u: UserRow) => {
    if (u.id === me?.id) { toast.error(t("admin.cannotDeleteSelf")); return; }
    if (!confirm(t("admin.confirmDelete", { username: u.username }))) return;
    try {
      await authApi.deleteUser(u.id);
      setUsers((prev) => prev.filter((r) => r.id !== u.id));
      toast.success(t("admin.userDeleted"));
    } catch {
      toast.error(t("admin.deleteUserError"));
    }
  };

  if (loading || fetching) {
    return (
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">{t("admin.title")}</h1>
            <p className="text-sm text-gray-500 mt-1">{t("admin.subtitle")}</p>
          </div>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">
                  {t("admin.loginColumn")}
                </th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">
                  {t("admin.nameEmailColumn")}
                </th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">
                  {t("admin.roleColumn")}
                </th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">
                  {t("admin.statusColumn")}
                </th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <SkeletonTableRows rows={5} cols={5} />
          </table>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">{t("admin.title")}</h1>
          <p className="text-sm text-gray-500 mt-1">
            {t("admin.subtitle")}
          </p>
        </div>
        <Button size="sm" onClick={() => setShowForm((v) => !v)}>
          {showForm ? t("common.cancel") : t("admin.newUser")}
        </Button>
      </div>

      {/* Create form */}
      {showForm && (
        <div className="rounded-xl border border-blue-100 bg-blue-50/40 p-6">
          <h2 className="text-sm font-semibold text-gray-800 mb-4">{t("admin.newUserFormTitle")}</h2>
          <form onSubmit={handleCreate} className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>{t("admin.usernameLabel")}</Label>
              <Input
                required
                placeholder={t("admin.usernamePlaceholder")}
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t("admin.emailLabel")}</Label>
              <Input
                type="email"
                placeholder={t("admin.emailPlaceholder")}
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t("admin.fullNameLabel")}</Label>
              <Input
                placeholder={t("admin.fullNamePlaceholder")}
                value={form.full_name}
                onChange={(e) => setForm({ ...form, full_name: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t("admin.roleLabel")}</Label>
              <Select
                value={form.role}
                onValueChange={(v) => setForm({ ...form, role: v ?? form.role })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="staff">{t("nav.staff")}</SelectItem>
                  <SelectItem value="admin">{t("nav.admin")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5 col-span-2">
              <Label>{t("admin.passwordLabel")}</Label>
              <Input
                type="password"
                required
                placeholder={t("admin.passwordPlaceholder")}
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
              />
            </div>
            <div className="col-span-2 flex justify-end gap-3">
              <Button type="button" variant="outline" onClick={() => setShowForm(false)}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? t("admin.creating") : t("common.create")}
              </Button>
            </div>
          </form>
        </div>
      )}

      {/* Users table */}
      <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">
                {t("admin.loginColumn")}
              </th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">
                {t("admin.nameEmailColumn")}
              </th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">
                {t("admin.roleColumn")}
              </th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">
                {t("admin.statusColumn")}
              </th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {users.map((u) => (
              <tr key={u.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-medium text-gray-900">
                  {u.username}
                  {u.id === me?.id && (
                    <span className="ml-1.5 text-xs text-blue-400">{t("admin.you")}</span>
                  )}
                </td>
                <td className="px-4 py-3 text-gray-500">
                  <div>{u.full_name || t("common.none")}</div>
                  {u.email && <div className="text-xs text-gray-400">{u.email}</div>}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                      u.role === "admin"
                        ? "bg-purple-50 text-purple-700"
                        : "bg-gray-100 text-gray-600"
                    }`}
                  >
                    {u.role === "admin" ? t("nav.admin") : t("nav.staff")}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                      u.is_active
                        ? "bg-green-50 text-green-700"
                        : "bg-red-50 text-red-600"
                    }`}
                  >
                    {u.is_active ? t("admin.active") : t("admin.inactive")}
                  </span>
                </td>
                <td className="px-4 py-3">
                  {u.id !== me?.id && (
                    <div className="flex items-center gap-2 justify-end">
                      <button
                        onClick={() => toggleActive(u)}
                        className="text-xs text-gray-400 hover:text-gray-700 transition-colors"
                      >
                        {u.is_active ? t("admin.deactivate") : t("admin.activate")}
                      </button>
                      <button
                        onClick={() => handleDelete(u)}
                        className="text-xs text-red-400 hover:text-red-600 transition-colors"
                      >
                        {t("common.delete")}
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {users.length === 0 && (
          <div className="py-8 text-center text-sm text-gray-400">
            {t("admin.noUsersFound")}
          </div>
        )}
      </div>
    </div>
  );
}
