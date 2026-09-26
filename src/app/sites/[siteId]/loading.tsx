import { Skeleton } from "@/components/ui/skeleton";

/**
 * Şantiye içi sayfalar (dashboard, ortaklar, formlar…) için genel yükleniyor iskeleti (CLAUDE.md 7.1).
 * Menü/başlık (layout) yerinde kalır; yalnızca içerik alanı iskelet gösterir, geçiş anında geri bildirim verir.
 * (irsaliye, personel, puantaj kendi özel iskeletlerini kullanır.)
 */
export default function Loading() {
  return (
    <div className="mx-auto max-w-5xl space-y-6" aria-busy="true" aria-label="Yükleniyor">
      <div className="flex gap-3 overflow-hidden">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-28 min-w-[70%] rounded-xl sm:min-w-[45%] md:min-w-0 md:flex-1" />
        ))}
      </div>
      <Skeleton className="h-48 w-full rounded-xl" />
      <div className="grid gap-3 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-12 rounded-xl" />
        ))}
      </div>
    </div>
  );
}
