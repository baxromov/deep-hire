"use client";

import { useRef, useState } from "react";
import { aiApi } from "@/lib/api";
import { AIFields } from "@/types/vacancy";

interface Props {
  onExtracted: (fields: AIFields) => void;
}

export function FileUploadZone({ onExtracted }: Props) {
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const process = async (file: File) => {
    setLoading(true);
    setError("");
    try {
      const res = await aiApi.extractFromFile(file);
      onExtracted(res.data);
    } catch {
      setError("Не удалось извлечь поля. Попробуйте снова или заполните вручную.");
    } finally {
      setLoading(false);
    }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) process(file);
  };

  return (
    <div
      className={`relative flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-10 text-center transition ${
        dragging ? "border-blue-400 bg-blue-50" : "border-gray-300 bg-gray-50"
      }`}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.docx,.doc"
        className="hidden"
        onChange={(e) => e.target.files?.[0] && process(e.target.files[0])}
      />
      {loading ? (
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-500 border-t-transparent" />
          <p className="text-sm text-gray-500">ИИ извлекает поля...</p>
        </div>
      ) : (
        <>
          <div className="mb-3 text-4xl">📄</div>
          <p className="font-medium text-gray-700">Перетащите PDF или DOCX файл сюда</p>
          <p className="mt-1 text-sm text-gray-400">или</p>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="mt-2 text-sm font-medium text-blue-600 underline-offset-2 hover:underline"
          >
            выбрать файл
          </button>
          <p className="mt-3 text-xs text-gray-400">ИИ автоматически заполнит поля вакансии</p>
        </>
      )}
      {error && <p className="mt-3 text-sm text-red-500">{error}</p>}
    </div>
  );
}
