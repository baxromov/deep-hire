import { Badge } from "@/components/ui/badge";
import { VacancyStatus } from "@/types/vacancy";

const config: Record<VacancyStatus, { label: string; className: string }> = {
  draft: { label: "Draft", className: "bg-gray-100 text-gray-600 border-gray-200" },
  approved: { label: "Approved", className: "bg-green-50 text-green-700 border-green-200" },
  closed: { label: "Closed", className: "bg-red-50 text-red-600 border-red-200" },
  archived: { label: "Archived", className: "bg-yellow-50 text-yellow-700 border-yellow-200" },
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
