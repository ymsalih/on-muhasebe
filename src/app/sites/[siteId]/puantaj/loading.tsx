import { Skeleton } from "@/components/ui/skeleton";

/** Yükleniyor durumu (CLAUDE.md 7.1): puantaj iskeleti. */
export default function Loading() {
  return (
    <div className="max-w-3xl space-y-4" aria-busy="true" aria-label="Yükleniyor">
      <Skeleton className="h-7 w-28" />
      <Skeleton className="h-11 w-64" />
      <div className="flex gap-2">
        <Skeleton className="size-11" />
        <Skeleton className="h-11 flex-1" />
        <Skeleton className="size-11" />
      </div>
      {[0, 1, 2, 3, 4].map((i) => (
        <Skeleton key={i} className="h-14 w-full rounded-xl" />
      ))}
    </div>
  );
}
