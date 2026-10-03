import { Skeleton } from "@/components/ui/skeleton";

/** Yükleniyor durumu (CLAUDE.md 7.1): Hakediş ve Fatura iskeleti. */
export default function Loading() {
  return (
    <div className="max-w-3xl space-y-5" aria-busy="true" aria-label="Yükleniyor">
      <Skeleton className="h-7 w-48" />
      <Skeleton className="h-16 w-full rounded-xl" />
      {[0, 1].map((i) => (
        <Skeleton key={i} className="h-14 w-full rounded-xl" />
      ))}
      <Skeleton className="h-16 w-full rounded-xl" />
      {[0, 1].map((i) => (
        <Skeleton key={i} className="h-14 w-full rounded-xl" />
      ))}
      <Skeleton className="h-36 w-full rounded-xl" />
    </div>
  );
}
