"use client";

import { useState } from "react";
import { useLocale } from "@/lib/i18n/context";

export type MethodCardProps = {
  id: string;
  icon: React.ReactNode;
  label: string;
  description: string;
  steps: string[];
  badge?: React.ReactNode;
  running: boolean;
  disabled: boolean;
  result?: number | null;   // matched count after last run
  onClick: () => void;
  onStop?: () => void;
  cornerAction?: React.ReactNode; // e.g. a settings-dialog trigger pinned to the top-right corner
  accentColor: string;
  accentBg: string;
  accentBorder: string;
};

export function MethodCard({ icon, label, description, steps, badge, running, disabled, result, onClick, onStop, cornerAction, accentColor, accentBg, accentBorder }: MethodCardProps) {
  const { t } = useLocale();
  const [showTooltip, setShowTooltip] = useState(false);
  const hasResult = result != null;

  return (
    <div className="relative">
      <button
        onClick={onClick}
        disabled={disabled || running}
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
        className={`group relative flex w-full flex-col items-start gap-2 overflow-hidden rounded-xl border p-4 text-left transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-50 ${cornerAction ? "pr-12" : ""}`}
        style={{
          borderColor: running ? accentColor : hasResult && result! > 0 ? accentColor + "60" : "#e2e8f0",
          background: running ? accentBg : "white",
          boxShadow: running ? `0 0 0 2px ${accentColor}40, 0 4px 12px ${accentColor}20` : "none",
        }}
      >
        {/* Running shimmer */}
        {running && (
          <div
            className="pointer-events-none absolute inset-0 -translate-x-full animate-[shimmer_2s_infinite]"
            style={{ background: `linear-gradient(90deg, transparent, ${accentColor}10, transparent)` }}
          />
        )}

        {/* Icon + badge row */}
        <div className="flex w-full items-start justify-between">
          <div
            className="flex h-8 w-8 items-center justify-center rounded-lg text-base"
            style={{ background: accentBg, color: accentColor, border: `1px solid ${accentBorder}` }}
          >
            {icon}
          </div>
          <div className="flex items-center gap-1.5">
            {/* Result star badge */}
            {hasResult && !running && (
              <span
                className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold"
                style={{
                  background: result! > 0 ? accentColor + "18" : "#64748b18",
                  color: result! > 0 ? accentColor : "#64748b",
                  border: `1px solid ${result! > 0 ? accentColor + "30" : "#64748b30"}`,
                }}
              >
                {result! > 0 ? "★" : "○"} {t("matchingUi.foundCount", { count: result! })}
              </span>
            )}
            {badge}
          </div>
        </div>

        {/* Label */}
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-semibold text-gray-800 group-hover:text-gray-900">
            {label}
          </span>
          {running && (
            <span
              className="flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold"
              style={{ background: accentBg, color: accentColor }}
            >
              <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full" style={{ background: accentColor }} />
              {t("matchingUi.running")}
            </span>
          )}
        </div>

        {/* Description — clamped to 2 lines so cards in the same row stay equal height */}
        <p className="line-clamp-2 min-h-[2.6em] text-[11.5px] leading-relaxed text-gray-400">{description}</p>
      </button>

      {/* Corner action — e.g. a settings-dialog trigger, sits above the card button so it never nests inside it */}
      {cornerAction && (
        <div className="absolute top-2.5 right-2.5 z-10" onClick={(e) => e.stopPropagation()}>
          {cornerAction}
        </div>
      )}

      {/* Stop button — shown when running */}
      {running && onStop && (
        <button
          onClick={(e) => { e.stopPropagation(); onStop(); }}
          className="absolute bottom-3 right-3 flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold transition-all hover:opacity-90 active:scale-95"
          style={{
            background: "#0f172a",
            color: "#f87171",
            border: "1px solid #ef444430",
            boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
          }}
          title={t("matchingUi.stopMatching")}
        >
          <svg width="9" height="9" viewBox="0 0 10 10" fill="currentColor">
            <rect x="1" y="1" width="8" height="8" rx="1.5"/>
          </svg>
          {t("matchingUi.stop")}
        </button>
      )}

      {/* Tooltip */}
      {showTooltip && !running && !disabled && (
        <div
          className="pointer-events-none absolute bottom-full left-0 z-50 mb-2 w-64 rounded-xl p-3 shadow-xl"
          style={{
            background: "#0f172a",
            border: `1px solid ${accentColor}40`,
            boxShadow: `0 8px 32px rgba(0,0,0,0.4), 0 0 0 1px ${accentColor}20`,
          }}
        >
          <p
            className="mb-2 text-[10px] font-bold uppercase tracking-widest"
            style={{ color: accentColor }}
          >
            {t("matchingUi.howItWorks")}
          </p>
          <ol className="space-y-1.5">
            {steps.map((s, i) => (
              <li key={i} className="flex items-start gap-2 text-[11.5px] text-slate-300">
                <span
                  className="mt-px flex h-4 w-4 shrink-0 items-center justify-center rounded text-[9px] font-bold"
                  style={{ background: accentColor + "20", color: accentColor }}
                >
                  {i + 1}
                </span>
                {s}
              </li>
            ))}
          </ol>
          {/* Arrow */}
          <div
            className="absolute -bottom-1.5 left-6 h-3 w-3 rotate-45"
            style={{ background: "#0f172a", border: `1px solid ${accentColor}40`, borderTop: "none", borderLeft: "none" }}
          />
        </div>
      )}
    </div>
  );
}
