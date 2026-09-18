import { cn } from "@/lib/utils";

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton", className)} aria-hidden="true" />;
}

export function SkeletonCard({ height = "h-40" }: { height?: string }) {
  return (
    <div className="card-afya p-5 space-y-3" aria-label="Loading content">
      <Skeleton className="h-4 w-1/3 rounded" />
      <Skeleton className={cn("w-full rounded", height)} />
      <Skeleton className="h-3 w-2/3 rounded" />
    </div>
  );
}

export function SkeletonState() {
  return (
    <div className="card-afya p-6 space-y-4" aria-label="Loading situation">
      <Skeleton className="h-6 w-48 rounded" />
      <Skeleton className="h-24 w-full rounded-xl" />
      <div className="grid grid-cols-3 gap-3">
        <Skeleton className="h-14 rounded-lg" />
        <Skeleton className="h-14 rounded-lg" />
        <Skeleton className="h-14 rounded-lg" />
      </div>
      <Skeleton className="h-10 w-full rounded-xl" />
    </div>
  );
}
