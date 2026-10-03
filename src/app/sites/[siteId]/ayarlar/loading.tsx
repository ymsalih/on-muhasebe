import { Skeleton } from "@/components/ui/skeleton";

/** Yükleniyor durumu (CLAUDE.md 7.1): Şantiye Ayarları iskeleti. */
export default function Loading() {
  return (
    <div className="max-w-2xl space-y-4" aria-busy="true" aria-label="Yükleniyor">
      <Skeleton className="h-7 w-48" />
      <Skeleton className="h-64 w-full rounded-xl" />
      <Skeleton className="h-32 w-full rounded-xl" />
    </div>
  );
}
