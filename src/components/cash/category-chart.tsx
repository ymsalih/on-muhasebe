import Link from "next/link";
import { BarChart3 } from "lucide-react";
import { buildHref } from "@/components/cash/range-filter";
import { CASH_TYPE_LABELS, type CashType } from "@/lib/cash/schemas";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";

export type ChartRow = { categoryId: number | null; name: string; total: number };

/**
 * Kategori dağılımı — yatay bar grafik (CLAUDE.md 7.3-D). Sade HTML/CSS çubukları: ek grafik kütüphanesi yüklemez, hızlıdır ve
 * ekran okuyucuyla okunur (her satırda ad, tutar ve yüzde metin olarak vardır). Bir çubuğa dokunmak listeyi o kategoriye süzer.
 */
export function CategoryChart({
  type,
  rows,
  base,
  linkParams,
  toggleParams,
  activeCategoryId,
}: {
  type: CashType;
  rows: ChartRow[];
  base: string;
  /** Çubuk bağlantılarında korunacak parametreler (aralık, tür…) */
  linkParams: Record<string, string | undefined>;
  /** Gelir/Gider geçişinde korunacak parametreler */
  toggleParams: Record<string, string | undefined>;
  activeCategoryId?: number;
}) {
  const sorted = [...rows].sort((a, b) => b.total - a.total);
  const total = sorted.reduce((s, r) => s + r.total, 0);
  const max = sorted[0]?.total ?? 0;
  const income = type === "income";

  return (
    <section aria-labelledby="chart-heading" className="space-y-3 rounded-xl border bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 id="chart-heading" className="flex items-center gap-2 text-sm font-semibold">
          <BarChart3 className="size-4 text-muted-foreground" aria-hidden />
          Kategori dağılımı
        </h2>
        <div role="group" aria-label="Grafik türü" className="inline-flex rounded-lg bg-muted p-1">
          {(["expense", "income"] as const).map((t) => (
            <Link
              key={t}
              href={buildHref(base, { ...toggleParams, grafik: t === "expense" ? undefined : "gelir" })}
              scroll={false}
              aria-pressed={type === t}
              className={cn(
                "inline-flex min-h-11 items-center rounded-md px-3.5 text-sm font-medium",
                type === t ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {CASH_TYPE_LABELS[t]}
            </Link>
          ))}
        </div>
      </div>

      {sorted.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted-foreground">Bu aralıkta {CASH_TYPE_LABELS[type].toLocaleLowerCase("tr-TR")} kaydı yok.</p>
      ) : (
        <ul className="space-y-1">
          {sorted.map((r) => {
            const pct = total > 0 ? (r.total / total) * 100 : 0;
            const inner = (
              <>
                <span className="flex items-baseline justify-between gap-3 text-sm">
                  <span className={cn("truncate", activeCategoryId === r.categoryId && "font-semibold")}>{r.name}</span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {formatCurrency(r.total)} · %{Math.round(pct)}
                  </span>
                </span>
                <span className="mt-1.5 block h-2.5 overflow-hidden rounded-full bg-muted" aria-hidden>
                  <span
                    className={cn("block h-full rounded-full", income ? "bg-emerald-500" : "bg-orange-500", activeCategoryId !== undefined && activeCategoryId !== r.categoryId && "opacity-40")}
                    style={{ width: `${max > 0 ? Math.max(2, (r.total / max) * 100) : 0}%` }}
                  />
                </span>
              </>
            );
            return (
              <li key={r.categoryId ?? "kategorisiz"}>
                {r.categoryId !== null ? (
                  <Link
                    href={buildHref(base, { ...linkParams, kategori: activeCategoryId === r.categoryId ? undefined : String(r.categoryId) })}
                    scroll={false}
                    className="block min-h-11 rounded-lg px-2 py-2 hover:bg-muted/50"
                    aria-label={`${r.name}: ${formatCurrency(r.total)}, yüzde ${Math.round(pct)}. Listeyi bu kategoriye süz`}
                  >
                    {inner}
                  </Link>
                ) : (
                  <div className="block min-h-11 rounded-lg px-2 py-2">{inner}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
