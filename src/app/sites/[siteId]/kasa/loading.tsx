import { Skeleton } from "@/components/ui/skeleton";

/** Yükleniyor durumu (CLAUDE.md 7.1): Genel Kasa iskeleti. */
export default function Loading() {
  return (
    <div className="max-w-3xl space-y-4" aria-busy="true" aria-label="Yükleniyor">
      <div className="flex items-center justify-between">
        <Skeleton className="h-7 w-36" />
        <Skeleton className="hidden h-11 w-44 md:block" />
      </div>
      <Skeleton className="h-11 w-72" />
      <div className="grid grid-cols-3 gap-2">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-20 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-44 w-full rounded-xl" />
      {[0, 1, 2, 3].map((i) => (
        <Skeleton key={i} className="h-16 w-full rounded-xl" />
      ))}
    </div>
  );
}
