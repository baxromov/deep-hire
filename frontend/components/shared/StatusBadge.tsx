import { Badge } from "@/components/ui/badge";
import { VacancyStatus } from "@/types/vacancy";

const config: Record<VacancyStatus, { label: string; className: string }> = {
  draft:    { label: "Черновик",     className: "bg-slate-100 text-slate-600 border-slate-200" },
  approved: { label: "Опубликовано", className: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  closed:   { label: "Закрыто",     className: "bg-red-50 text-red-600 border-red-200" },
  archived: { label: "Архив",       className: "bg-amber-50 text-amber-700 border-amber-200" },
};

export function StatusBadge({ status }: { status: VacancyStatus }) {
  const { label, className } = config[status];
  return (
    <Badge variant="outline" className={className}>
      <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-current" />
      {label}
    </Badge>
  );
}
