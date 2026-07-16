"use client";

import { Badge } from "@/components/ui/badge";
import { VacancyStatus } from "@/types/vacancy";
import { useLocale } from "@/lib/i18n/context";

const config: Record<VacancyStatus, { key: string; className: string }> = {
  draft:    { key: "statusBadge.draft",    className: "bg-slate-100 text-slate-600 border-slate-200" },
  approved: { key: "statusBadge.approved", className: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  closed:   { key: "statusBadge.closed",   className: "bg-red-50 text-red-600 border-red-200" },
  archived: { key: "statusBadge.archived", className: "bg-amber-50 text-amber-700 border-amber-200" },
};

export function StatusBadge({ status }: { status: VacancyStatus }) {
  const { t } = useLocale();
  const { key, className } = config[status];
  return (
    <Badge variant="outline" className={className}>
      <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-current" />
      {t(key)}
    </Badge>
  );
}
