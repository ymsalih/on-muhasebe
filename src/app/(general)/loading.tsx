import { Skeleton } from "@/components/ui/skeleton";

/** Şantiye listesi ve admin sayfaları için genel yükleniyor iskeleti (CLAUDE.md 7.1). */
export default function Loading() {
  return (
    <div className="max-w-3xl space-y-3" aria-busy="true" aria-label="Yükleniyor">
      <Skeleton className="h-6 w-48" />
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className="h-20 w-full rounded-xl" />
      ))}
    </div>
  );
}
