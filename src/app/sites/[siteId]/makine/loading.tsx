import { Skeleton } from "@/components/ui/skeleton";

/** Yükleniyor durumu (CLAUDE.md 7.1): İş Makineleri iskeleti. */
export default function Loading() {
  return (
    <div className="max-w-3xl space-y-4" aria-busy="true" aria-label="Yükleniyor">
      <Skeleton className="h-7 w-40" />
      <Skeleton className="h-11 w-full max-w-md" />
      <Skeleton className="h-11 w-72" />
      {[0, 1, 2, 3].map((i) => (
        <Skeleton key={i} className="h-16 w-full rounded-xl" />
      ))}
    </div>
  );
}
