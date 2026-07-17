"use client";

import { useState } from "react";

const LOCALE_MAP: Record<string, string> = { uz: "uz-UZ", ru: "ru-RU", en: "en-US" };

export function TrendChart({ data, color, locale }: { data: { date: string; count: number }[]; color: string; locale: string }) {
  const [hovered, setHovered] = useState<number | null>(null);
  const max = Math.max(1, ...data.map((d) => d.count));
  const intlLocale = LOCALE_MAP[locale] || "ru-RU";

  return (
    <div className="flex items-end gap-2" style={{ height: 96 }}>
      {data.map((d, i) => {
        const dayLabel = new Intl.DateTimeFormat(intlLocale, { weekday: "short" }).format(new Date(`${d.date}T00:00:00`));
        const heightPct = Math.max(4, (d.count / max) * 100);
        const isHovered = hovered === i;
        return (
          <div
            key={d.date}
            className="flex flex-1 flex-col items-center gap-1.5"
            onMouseEnter={() => setHovered(i)}
            onMouseLeave={() => setHovered(null)}
          >
            <div className="relative flex h-16 w-full items-end justify-center">
              {isHovered && (
                <span className="absolute -top-6 rounded-md bg-gray-900 px-1.5 py-0.5 text-[10px] font-semibold text-white shadow-sm">
                  {d.count}
                </span>
              )}
              <div
                className="w-full max-w-[22px] rounded-t-md transition-all duration-300"
                style={{
                  height: `${heightPct}%`,
                  background: isHovered ? color : `${color}99`,
                }}
              />
            </div>
            <span className="text-[10px] font-medium capitalize text-gray-400">{dayLabel}</span>
          </div>
        );
      })}
    </div>
  );
}
