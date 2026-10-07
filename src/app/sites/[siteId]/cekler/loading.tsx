import { Skeleton } from "@/components/ui/skeleton";

/** Yükleniyor durumu (CLAUDE.md 7.1): Çekler iskeleti. */
export default function Loading() {
  return (
    <div className="max-w-3xl space-y-4" aria-busy="true" aria-label="Yükleniyor">
      <Skeleton className="h-7 w-32" />
      <div className="grid grid-cols-2 gap-2">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-24 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-11 w-full max-w-md" />
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className="h-20 w-full rounded-xl" />
      ))}
    </div>
  );
}
