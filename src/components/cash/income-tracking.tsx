import Link from "next/link";
import { ArrowRightLeft, ChevronRight } from "lucide-react";
import { buildHref } from "@/components/cash/range-filter";
import { remainingOf, type IncomeAllocation } from "@/lib/cash/sources";
import type { ExpenseSourceSplit } from "@/lib/cash/queries";
import { formatCurrency, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

type Group = { key: string; id: number | null; name: string; income: number; spent: number; items: IncomeAllocation[] };

const pct = (part: number, whole: number) => (whole > 0 ? Math.min(100, Math.round((part / whole) * 100)) : 0);

/**
 * Gelir → Gider takibi: seçili aralıktaki gelirlerin kategorisine göre, her birinden ne kadar harcandığı ve ne kadarının kaldığı.
 * Bir gelire dokununca Genel Kasa o gelirin giderlerine süzülür. Harcanan = o gelire bağlı TÜM giderler (tarihleri aralık dışında olsa da).
 */
export function IncomeTracking({
  base,
  rangeParams,
  allocations,
  catName,
  split,
  activeSource,
}: {
  base: string;
  rangeParams: Record<string, string | undefined>;
  allocations: IncomeAllocation[];
  catName: Map<number, string>;
  split: ExpenseSourceSplit;
  activeSource?: number;
}) {
  const groups = new Map<string, Group>();
  for (const a of allocations) {
    const key = a.categoryId === null ? "none" : String(a.categoryId);
    const g = groups.get(key) ?? { key, id: a.categoryId, name: a.categoryId === null ? "Kategorisiz" : (catName.get(a.categoryId) ?? "Kategori"), income: 0, spent: 0, items: [] };
    g.income += a.amount;
    g.spent += a.spent;
    g.items.push(a);
    groups.set(key, g);
  }
  const sorted = [...groups.values()].sort((a, b) => b.income - a.income);
  const totalIncome = allocations.reduce((s, a) => s + a.amount, 0);
  const totalSpent = allocations.reduce((s, a) => s + a.spent, 0);
  const hasAny = allocations.length > 0 || split.linkedCount > 0 || split.unlinkedCount > 0;
  const expenseLink = (extra: Record<string, string | undefined>) => buildHref(base, { ...rangeParams, tur: "gider", ...extra });

  return (
    <section aria-labelledby="tracking-heading" className="space-y-3 rounded-xl border bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 id="tracking-heading" className="flex items-center gap-2 text-sm font-semibold">
          <ArrowRightLeft className="size-4 text-muted-foreground" aria-hidden />
          Gelir → Gider takibi
        </h2>
        {allocations.length > 0 && (
          <span className="text-xs text-muted-foreground tabular-nums">
            Harcanan {formatCurrency(totalSpent)} / {formatCurrency(totalIncome)}
          </span>
        )}
      </div>

      {!hasAny ? (
        <p className="py-3 text-center text-sm text-muted-foreground">Bu aralıkta gelir veya gider yok. Gider eklerken “Hangi gelirden?” seçerek takibi başlatın.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2">
            <Link href={expenseLink({ kaynak: "var" })} scroll={false} className="min-h-11 rounded-lg border px-3 py-2 hover:bg-muted/50">
              <span className="block text-xs text-muted-foreground">Kaynağı belirtilmiş gider</span>
              <span className="block text-sm font-semibold tabular-nums text-orange-700 dark:text-orange-400">{formatCurrency(split.linked)}</span>
              <span className="block text-[11px] text-muted-foreground">{split.linkedCount} kayıt</span>
            </Link>
            <Link href={expenseLink({ kaynak: "yok" })} scroll={false} className="min-h-11 rounded-lg border px-3 py-2 hover:bg-muted/50">
              <span className="block text-xs text-muted-foreground">Kaynağı belirtilmemiş gider</span>
              <span className="block text-sm font-semibold tabular-nums">{formatCurrency(split.unlinked)}</span>
              <span className="block text-[11px] text-muted-foreground">{split.unlinkedCount} kayıt</span>
            </Link>
          </div>

          {sorted.length === 0 ? (
            <p className="text-sm text-muted-foreground">Bu aralıkta gelir kaydı yok.</p>
          ) : (
            <div className="space-y-2">
              {sorted.map((g) => {
                const remaining = Math.round((g.income - g.spent) * 100) / 100;
                return (
                  <details key={g.key} open={sorted.length <= 3 || g.items.some((i) => i.id === activeSource)} className="group rounded-lg border">
                    <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 px-3 py-2 [&::-webkit-details-marker]:hidden">
                      <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" aria-hidden />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline justify-between gap-3">
                          <span className="truncate text-sm font-medium">{g.name}</span>
                          <span className="shrink-0 text-sm font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">{formatCurrency(g.income)}</span>
                        </span>
                        <span className="mt-1.5 block h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
                          <span className={cn("block h-full rounded-full", remaining < 0 ? "bg-red-500" : "bg-orange-500")} style={{ width: `${pct(g.spent, g.income)}%` }} />
                        </span>
                        <span className="mt-1 flex justify-between gap-3 text-xs text-muted-foreground tabular-nums">
                          <span>Harcanan {formatCurrency(g.spent)}</span>
                          <span className={cn(remaining < 0 && "font-medium text-red-600 dark:text-red-400")}>Kalan {formatCurrency(remaining)}</span>
                        </span>
                      </span>
                    </summary>
                    <ul className="divide-y border-t">
                      {g.items.map((a) => {
                        const rem = remainingOf(a);
                        return (
                          <li key={a.id}>
                            <Link
                              href={expenseLink({ kaynak: String(a.id) })}
                              scroll={false}
                              aria-label={`${a.description}: gelir ${formatCurrency(a.amount)}, harcanan ${formatCurrency(a.spent)}, kalan ${formatCurrency(rem)}. Giderlerini göster`}
                              className={cn("block min-h-12 px-3 py-2 hover:bg-muted/50", activeSource === a.id && "bg-muted/60")}
                            >
                              <span className="flex items-baseline justify-between gap-3">
                                <span className="min-w-0 truncate text-sm">{a.description}</span>
                                <span className="shrink-0 text-sm font-medium tabular-nums">{formatCurrency(a.amount)}</span>
                              </span>
                              <span className="flex justify-between gap-3 text-xs text-muted-foreground tabular-nums">
                                <span>
                                  {formatDate(a.date)} · {a.expenseCount} gider · harcanan {formatCurrency(a.spent)}
                                </span>
                                <span className={cn(rem < 0 && "font-medium text-red-600 dark:text-red-400")}>kalan {formatCurrency(rem)}</span>
                              </span>
                            </Link>
                          </li>
                        );
                      })}
                    </ul>
                  </details>
                );
              })}
            </div>
          )}
        </>
      )}
    </section>
  );
}
