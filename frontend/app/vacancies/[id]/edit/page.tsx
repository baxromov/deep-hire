"use client";

import { use, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { VacancyForm } from "@/components/vacancies/VacancyForm";
import { FileUploadZone } from "@/components/vacancies/FileUploadZone";
import { DescriptionInput } from "@/components/vacancies/DescriptionInput";
import { vacancyApi } from "@/lib/api";
import { AIFields, Vacancy } from "@/types/vacancy";
import useSWR from "swr";

type Props = { params: Promise<{ id: string }> };

export default function EditVacancyPage({ params }: Props) {
  const { id } = use(params);
  const router = useRouter();
  const [aiFields, setAiFields] = useState<AIFields | null>(null);
  const [mode, setMode] = useState<"form" | "file" | "text">("form");
  const [loading, setLoading] = useState(false);

  const { data: vacancy } = useSWR<Vacancy>(
    id,
    () => vacancyApi.get(id).then((r) => r.data)
  );

  const onExtracted = (fields: AIFields) => {
    setAiFields(fields);
    setMode("form");
    toast.success("Fields extracted! Review and save.");
  };

  const save = async (data: Record<string, unknown>, approve = false) => {
    setLoading(true);
    try {
      await vacancyApi.update(id, data);
      if (approve) {
        await vacancyApi.approve(id);
        toast.success("Vacancy approved!");
      } else {
        toast.success("Saved as draft");
      }
      router.push(`/vacancies/${id}`);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })
        ?.response?.data?.detail || "Save failed";
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  if (!vacancy) {
    return (
      <div className="flex justify-center pt-20">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-500 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl">
      <div className="mb-6 flex items-center justify-between">
        <button onClick={() => router.back()} className="text-sm text-gray-500 hover:text-gray-700">
          ← Back
        </button>
        <h1 className="text-xl font-semibold text-gray-900">
          {vacancy.title || "New Vacancy"}
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
            Skip, fill manually
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
            Skip, fill manually
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
            <span className="text-sm font-medium text-gray-700">Upload File</span>
            <span className="text-xs text-gray-400">PDF or DOCX</span>
          </button>
          <button
            onClick={() => setMode("text")}
            className="flex flex-1 flex-col items-center gap-2 rounded-xl border-2 border-dashed border-gray-200 p-6 text-center hover:border-blue-300 hover:bg-blue-50 transition"
          >
            <span className="text-2xl">✏️</span>
            <span className="text-sm font-medium text-gray-700">Write Description</span>
            <span className="text-xs text-gray-400">AI extracts fields</span>
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
