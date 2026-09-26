import Link from "next/link";
import { RANGE_KEYS, RANGE_LABELS, type ResolvedRange } from "@/lib/cash/range";
import { cn } from "@/lib/utils";

/** Adres parametrelerini koruyarak bağlantı üretir (boş/undefined olanlar atılır). */
export function buildHref(base: string, params: Record<string, string | undefined>) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) sp.set(k, v);
  const qs = sp.toString();
  return qs ? `${base}?${qs}` : base;
}

/**
 * Gün/ay filtre çubuğu (CLAUDE.md 7.3-D): Bugün / Bu Hafta / Bu Ay / Özel Aralık segment kontrolü.
 * Diğer süzgeçler (tür, kategori, grafik) korunur; aralık değişince sayfalama sıfırlanır.
 */
export function RangeFilter({
  base,
  range,
  keep,
}: {
  base: string;
  range: ResolvedRange;
  /** Aralık değişse de korunacak parametreler (tur, kategori, grafik) */
  keep: Record<string, string | undefined>;
}) {
  return (
    <div className="space-y-3">
      <div role="tablist" aria-label="Tarih aralığı" className="-mx-4 flex gap-1 overflow-x-auto px-4 md:mx-0 md:px-0">
        <div className="inline-flex rounded-lg bg-muted p-1">
          {RANGE_KEYS.map((k) => (
            <Link
              key={k}
              role="tab"
              aria-selected={range.key === k}
              scroll={false}
              href={buildHref(base, { ...keep, aralik: k === "ay" ? undefined : k, ...(k === "ozel" ? { baslangic: range.from, bitis: range.to } : {}) })}
              className={cn(
                "inline-flex min-h-11 shrink-0 items-center whitespace-nowrap rounded-md px-3.5 text-sm font-medium",
                range.key === k ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {RANGE_LABELS[k]}
            </Link>
          ))}
        </div>
      </div>

      {range.key === "ozel" ? (
        <form method="get" action={base} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="aralik" value="ozel" />
          {Object.entries(keep).map(([k, v]) => v && <input key={k} type="hidden" name={k} value={v} />)}
          <label className="space-y-1 text-xs text-muted-foreground">
            Başlangıç
            <input type="date" name="baslangic" defaultValue={range.from} required className="block h-11 rounded-lg border border-input bg-transparent px-2.5 text-base text-foreground md:text-sm" />
          </label>
          <label className="space-y-1 text-xs text-muted-foreground">
            Bitiş
            <input type="date" name="bitis" defaultValue={range.to} required className="block h-11 rounded-lg border border-input bg-transparent px-2.5 text-base text-foreground md:text-sm" />
          </label>
          <button type="submit" className="h-11 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground">
            Uygula
          </button>
        </form>
      ) : (
        <p className="text-sm text-muted-foreground">{range.label}</p>
      )}
    </div>
  );
}
