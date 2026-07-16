import { cn } from "@/lib/utils"

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("animate-pulse rounded-md bg-gray-200/80", className)}
      {...props}
    />
  )
}

function SkeletonLine({ className, ...props }: React.ComponentProps<"div">) {
  return <Skeleton className={cn("h-4 w-full", className)} {...props} />
}

function SkeletonAvatar({ className, ...props }: React.ComponentProps<"div">) {
  return <Skeleton className={cn("h-10 w-10 rounded-full shrink-0", className)} {...props} />
}

/** A table body of skeleton rows, matching a real table's <tbody> so it drops
 * into the same <table> shell (thead stays real, only rows are placeholders). */
function SkeletonTableRows({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <tbody className="divide-y divide-gray-100">
      {Array.from({ length: rows }).map((_, r) => (
        <tr key={r}>
          {Array.from({ length: cols }).map((_, c) => (
            <td key={c} className="px-3 py-3.5">
              <SkeletonLine className={c === 0 ? "w-32" : "w-16"} />
            </td>
          ))}
        </tr>
      ))}
    </tbody>
  )
}

export { Skeleton, SkeletonLine, SkeletonAvatar, SkeletonTableRows }
