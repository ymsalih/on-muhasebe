import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Scale, Settings2, TrendingDown, TrendingUp } from "lucide-react";
import { CashLedger } from "@/components/cash/cash-ledger";
import { CategoryChart, type ChartRow } from "@/components/cash/category-chart";
import { RangeFilter, buildHref } from "@/components/cash/range-filter";
import { requireUser } from "@/lib/auth/session";
import { getCashSummary, getExpenseSourceSplit, getIncomeAllocations, listCashTransactions, listCategories } from "@/lib/cash/queries";
import { IncomeTracking } from "@/components/cash/income-tracking";
import { incomeShortLabel, toIncomeSources } from "@/lib/cash/sources";
import { resolveRange } from "@/lib/cash/range";
import type { CashType } from "@/lib/cash/schemas";
import { formatCurrency } from "@/lib/format";
import { listParties } from "@/lib/goods/queries";
import { todayInIstanbul } from "@/lib/personnel/status";
import { canWriteRole, getSiteRole } from "@/lib/sites/queries";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Genel Kasa — ÖZN YOL" };

const PAGE_SIZE = 100;
const MAX_LIMIT = 1000;

/** Genel Kasa / Finans Merkezi (CLAUDE.md 7.3-D). */
export default async function CashPage({
  params,
  searchParams,
}: {
  params: Promise<{ siteId: string }>;
  searchParams: Promise<{ aralik?: string; baslangic?: string; bitis?: string; tur?: string; kategori?: string; kaynak?: string; grafik?: string; limit?: string; ekle?: string }>;
}) {
  const { siteId: rawId } = await params;
  const sp = await searchParams;
  const siteId = Number(rawId);
  if (!Number.isInteger(siteId)) notFound();

  const today = todayInIstanbul();
  const range = resolveRange(sp.aralik, today, sp.baslangic, sp.bitis);
  const listType: CashType | undefined = sp.tur === "gelir" ? "income" : sp.tur === "gider" ? "expense" : undefined;
  const categoryId = Number.isInteger(Number(sp.kategori)) && Number(sp.kategori) > 0 ? Number(sp.kategori) : undefined;
  // Gider kaynağı süzgeci: belirli bir gelirin giderleri (id), kaynağı belirtilmiş ("var") ya da belirtilmemiş ("yok") giderler.
  // Yalnızca giderler için geçerlidir; tür "gelir" seçiliyse yok sayılır.
  const sourceFilter: number | "any" | "none" | undefined =
    listType === "income" ? undefined : /^\d+$/.test(sp.kaynak ?? "") ? Number(sp.kaynak) : sp.kaynak === "var" ? "any" : sp.kaynak === "yok" ? "none" : undefined;
  const chartType: CashType = sp.grafik === "gelir" ? "income" : "expense";
  const limit = Math.min(Math.max(Number(sp.limit) || PAGE_SIZE, PAGE_SIZE), MAX_LIMIT);
  const base = `/sites/${siteId}/kasa`;

  // Tüm veri kimlik doğrulamayla birlikte (paralel) istenir.
  const [, role, categories, list, summary, parties, allAllocations, split] = await Promise.all([
    requireUser(),
    getSiteRole(siteId),
    listCategories(siteId),
    listCashTransactions(siteId, { from: range.from, to: range.to, type: listType, categoryId, source: sourceFilter }, limit),
    getCashSummary(siteId, range.from, range.to),
    listParties(siteId),
    getIncomeAllocations(siteId, null, null),
    getExpenseSourceSplit(siteId, range.from, range.to),
  ]);
  const canWrite = canWriteRole(role);

  const catName = new Map(categories.map((c) => [c.id, c.name]));
  const inRange = allAllocations.filter((a) => a.date >= range.from && a.date <= range.to);
  const incomeInfo = Object.fromEntries(allAllocations.map((a) => [a.id, { label: incomeShortLabel(a, catName), amount: a.amount, spent: a.spent }]));
  const activeSourceLabel = typeof sourceFilter === "number" ? (incomeInfo[sourceFilter]?.label ?? "Seçili gelir") : undefined;
  const chartRows: ChartRow[] = summary.byCategory
    .filter((r) => r.type === chartType)
    .map((r) => ({ categoryId: r.category_id, name: r.category_id === null ? "Kategorisiz" : (catName.get(r.category_id) ?? "Silinmiş kategori"), total: r.total }));

  const net = summary.income - summary.expense;
  // Süzgeçler değişince korunacak parametreler
  const rangeParams = { aralik: range.key === "ay" ? undefined : range.key, baslangic: range.key === "ozel" ? range.from : undefined, bitis: range.key === "ozel" ? range.to : undefined };
  const keepForRange = { tur: sp.tur, kategori: sp.kategori, kaynak: sp.kaynak, grafik: sp.grafik };
  const keepForType = { ...rangeParams, kategori: sp.kategori, grafik: sp.grafik };
  const moreHref = buildHref(base, { ...rangeParams, tur: sp.tur, kategori: sp.kategori, kaynak: sp.kaynak, grafik: sp.grafik, limit: String(limit + PAGE_SIZE) });
  const activeCategoryName = categoryId ? (catName.get(categoryId) ?? "Kategori") : undefined;
  const filtered = !!listType || !!categoryId || sourceFilter !== undefined;

  const cards = [
    { label: "Toplam Gelir", value: summary.income, icon: TrendingUp, tone: "text-emerald-700 dark:text-emerald-400", bg: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400" },
    { label: "Toplam Gider", value: summary.expense, icon: TrendingDown, tone: "text-orange-700 dark:text-orange-400", bg: "bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-400" },
    { label: "Net", value: net, icon: Scale, tone: net >= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-red-600 dark:text-red-400", bg: "bg-muted text-muted-foreground" },
  ];

  return (
    <CashLedger
      siteId={siteId}
      rows={list.rows}
      hasMore={list.hasMore}
      moreHref={moreHref}
      categories={categories}
      parties={parties.map((p) => ({ id: p.id, name: p.name }))}
      canWrite={canWrite}
      today={today}
      autoOpen={sp.ekle === "1"}
      filtered={filtered}
      incomeSources={toIncomeSources(allAllocations, catName)}
      incomeInfo={incomeInfo}
    >
      <RangeFilter base={base} range={range} keep={keepForRange} />

      <section aria-label="Aralık özeti" className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {cards.map(({ label, value, icon: Icon, tone, bg }, i) => (
          // Mobilde Gelir/Gider yan yana, Net alt satırda tam genişlik: tutarlar ASLA kesilmez.
          <div key={label} className={cn("min-w-0 rounded-xl border bg-card p-3 sm:p-4", i === 2 && "col-span-2 sm:col-span-1")}>
            <div className="mb-2 flex items-center gap-2">
              <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-lg", bg)}>
                <Icon className="size-4" aria-hidden />
              </span>
              <span className="text-sm text-muted-foreground">{label}</span>
            </div>
            <p className={cn("text-lg font-semibold tabular-nums sm:text-xl", tone)}>{formatCurrency(value)}</p>
          </div>
        ))}
      </section>

      <CategoryChart
        type={chartType}
        rows={chartRows}
        base={base}
        linkParams={{ ...rangeParams, tur: sp.tur, grafik: sp.grafik }}
        toggleParams={{ ...rangeParams, tur: sp.tur, kategori: sp.kategori }}
        activeCategoryId={categoryId}
      />

      <IncomeTracking
        base={base}
        rangeParams={rangeParams}
        allocations={inRange}
        catName={catName}
        split={split}
        activeSource={typeof sourceFilter === "number" ? sourceFilter : undefined}
      />

      <div className="flex flex-wrap items-center gap-2">
        <nav aria-label="Türe göre filtre" className="inline-flex rounded-lg bg-muted p-1">
          {([undefined, "gelir", "gider"] as const).map((t) => (
            <Link
              key={t ?? "hepsi"}
              href={buildHref(base, { ...keepForType, tur: t })}
              scroll={false}
              aria-current={sp.tur === t || (!sp.tur && !t) ? "true" : undefined}
              className={cn(
                "inline-flex min-h-11 items-center rounded-md px-4 text-sm font-medium",
                (sp.tur ?? undefined) === t || (!sp.tur && !t) ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t === "gelir" ? "Gelir" : t === "gider" ? "Gider" : "Tümü"}
            </Link>
          ))}
        </nav>
        {(listType === "expense" || sourceFilter !== undefined) && (
          <nav aria-label="Gider kaynağı süzgeci" className="inline-flex rounded-lg bg-muted p-1">
            {(
              [
                [undefined, "Tüm giderler"],
                ["var", "Kaynaklı"],
                ["yok", "Kaynaksız"],
              ] as const
            ).map(([k, label]) => {
              const active = typeof sourceFilter === "number" ? false : (sp.kaynak ?? undefined) === k && (k === undefined ? sourceFilter === undefined : true);
              return (
                <Link
                  key={label}
                  href={buildHref(base, { ...rangeParams, tur: "gider", kategori: sp.kategori, grafik: sp.grafik, kaynak: k })}
                  scroll={false}
                  aria-current={active ? "true" : undefined}
                  className={cn("inline-flex min-h-11 items-center rounded-md px-3.5 text-sm font-medium", active ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground")}
                >
                  {label}
                </Link>
              );
            })}
          </nav>
        )}
        {activeSourceLabel && (
          <Link
            href={buildHref(base, { ...rangeParams, tur: "gider", kategori: sp.kategori, grafik: sp.grafik })}
            scroll={false}
            className="inline-flex min-h-11 max-w-full items-center gap-1.5 rounded-full border bg-card px-4 text-sm font-medium"
            aria-label={`${activeSourceLabel} kaynak süzgecini kaldır`}
          >
            <span className="truncate">Kaynak: {activeSourceLabel}</span> <span aria-hidden>✕</span>
          </Link>
        )}
        {activeCategoryName && (
          <Link
            href={buildHref(base, { ...rangeParams, tur: sp.tur, grafik: sp.grafik })}
            scroll={false}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-full border bg-card px-4 text-sm font-medium"
            aria-label={`${activeCategoryName} kategori süzgecini kaldır`}
          >
            {activeCategoryName} <span aria-hidden>✕</span>
          </Link>
        )}
        {canWrite && (
          <Link href={`${base}/kategoriler`} className="ml-auto inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground">
            <Settings2 className="size-4" aria-hidden />
            Kategoriler
          </Link>
        )}
      </div>
    </CashLedger>
  );
}
