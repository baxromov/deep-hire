"use client";

import { use, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { VacancyForm } from "@/components/vacancies/VacancyForm";
import { FileUploadZone } from "@/components/vacancies/FileUploadZone";
import { DescriptionInput } from "@/components/vacancies/DescriptionInput";
import { vacancyApi } from "@/lib/api";
import { AIFields, Vacancy } from "@/types/vacancy";
import useSWR from "swr";
import { useLocale } from "@/lib/i18n/context";
import { Skeleton, SkeletonLine } from "@/components/ui/skeleton";

type Props = { params: Promise<{ id: string }> };

export default function EditVacancyPage({ params }: Props) {
  const { id } = use(params);
  const router = useRouter();
  const { t } = useLocale();
  const [aiFields, setAiFields] = useState<AIFields | null>(null);
  const [mode, setMode] = useState<"form" | "file" | "text">("form");
  const [loading, setLoading] = useState(false);
  const savedRef = useRef(false);

  const { data: vacancy } = useSWR<Vacancy>(
    id,
    () => vacancyApi.get(id).then((r) => r.data)
  );

  // If the user leaves without ever saving a still-blank draft (abandoned
  // "Новая вакансия" click), clean it up instead of leaving a permanent
  // "Без названия" row in the list.
  const cleanupIfBlank = () => {
    if (!savedRef.current && vacancy && !vacancy.title && vacancy.status === "draft") {
      vacancyApi.delete(id).catch(() => {});
    }
  };

  useEffect(() => () => cleanupIfBlank(), [vacancy]);

  const onExtracted = (fields: AIFields) => {
    setAiFields(fields);
    setMode("form");
    toast.success(t("vacanciesEdit.toastFieldsExtracted"));
  };

  const save = async (data: Record<string, unknown>, approve = false) => {
    setLoading(true);
    try {
      await vacancyApi.update(id, data);
      savedRef.current = true;
      if (approve) {
        await vacancyApi.approve(id);
        toast.success(t("vacanciesEdit.toastPublished"));
      } else {
        toast.success(t("vacanciesEdit.toastSavedDraft"));
      }
      router.push(`/vacancies/${id}`);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })
        ?.response?.data?.detail || t("vacanciesEdit.toastSaveFailed");
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  if (!vacancy) {
    return (
      <div className="max-w-2xl">
        <div className="mb-6 flex items-center justify-between">
          <SkeletonLine className="h-4 w-16" />
          <SkeletonLine className="h-5 w-40" />
          <div />
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="space-y-5">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="space-y-2">
                <SkeletonLine className="h-3 w-24" />
                <Skeleton className={i === 3 ? "h-24 w-full" : "h-9 w-full"} />
              </div>
            ))}
            <div className="flex gap-3 pt-2">
              <Skeleton className="h-9 w-28" />
              <Skeleton className="h-9 w-28" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl">
      <div className="mb-6 flex items-center justify-between">
        <button onClick={() => { cleanupIfBlank(); router.back(); }} className="text-sm text-gray-500 hover:text-gray-700">
          ← {t("common.back")}
        </button>
        <h1 className="text-xl font-semibold text-gray-900">
          {vacancy.title || t("vacanciesEdit.newVacancyTitle")}
        </h1>
        <div />
      </div>

      {mode === "file" && (
        <div className="mb-6">
          <FileUploadZone onExtracted={onExtracted} />
          <button
            onClick={() => setMode("form")}
            className="mt-3 text-sm text-gray-500 underline"
          >
            {t("vacanciesEdit.skipManualFill")}
          </button>
        </div>
      )}

      {mode === "text" && (
        <div className="mb-6">
          <DescriptionInput onExtracted={onExtracted} />
          <button
            onClick={() => setMode("form")}
            className="mt-3 text-sm text-gray-500 underline"
          >
            {t("vacanciesEdit.skipManualFill")}
          </button>
        </div>
      )}

      {mode === "form" && !aiFields && vacancy.status === "draft" && !vacancy.title && (
        <div className="mb-6 flex gap-3">
          <button
            onClick={() => setMode("file")}
            className="flex flex-1 flex-col items-center gap-2 rounded-xl border-2 border-dashed border-gray-200 p-6 text-center hover:border-blue-300 hover:bg-blue-50 transition"
          >
            <span className="text-2xl">📄</span>
            <span className="text-sm font-medium text-gray-700">{t("vacanciesEdit.uploadFile")}</span>
            <span className="text-xs text-gray-400">{t("vacanciesEdit.uploadFileHint")}</span>
          </button>
          <button
            onClick={() => setMode("text")}
            className="flex flex-1 flex-col items-center gap-2 rounded-xl border-2 border-dashed border-gray-200 p-6 text-center hover:border-blue-300 hover:bg-blue-50 transition"
          >
            <span className="text-2xl">✏️</span>
            <span className="text-sm font-medium text-gray-700">{t("vacanciesEdit.writeDescription")}</span>
            <span className="text-xs text-gray-400">{t("vacanciesEdit.writeDescriptionHint")}</span>
          </button>
        </div>
      )}

      <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <VacancyForm
          key={`${vacancy.id}-${aiFields ? "ai" : "base"}`}
          defaultValues={{ ...vacancy, skills: vacancy.skills ?? [], ...(aiFields ?? {}) }}
          onSaveDraft={(data) => save(data, false)}
          onPublish={(data) => save(data, true)}
          loading={loading}
        />
      </div>
    </div>
  );
}
