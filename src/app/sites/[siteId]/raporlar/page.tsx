import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BarChart3, FileSpreadsheet, FileText, Scale, TrendingDown, TrendingUp } from "lucide-react";
import { DataRow } from "@/components/data-row";
import { CategoryPie } from "@/components/reports/category-pie";
import { TrendChart } from "@/components/reports/trend-chart";
import { RangeFilter, buildHref } from "@/components/cash/range-filter";
import { CategoryBadge } from "@/components/parties/balance";
import { requireUser } from "@/lib/auth/session";
import { resolveRange } from "@/lib/cash/range";
import { formatCurrency } from "@/lib/format";
import { todayInIstanbul } from "@/lib/personnel/status";
import { pieColor } from "@/lib/reports/colors";
import { REPORT_TABS, REPORT_TAB_LABELS, loadReport, resolveTab, type CategoryRow } from "@/lib/reports/queries";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Raporlar — Şantiye Ön Muhasebe" };

/** Raporlar (CLAUDE.md 7.3-I): dönem seçici + Genel Trend / Kategori Dağılımı / Cari Bazlı / Personel Bazlı, her sekmede PDF/Excel. */
export default async function ReportsPage({
  params,
  searchParams,
}: {
  params: Promise<{ siteId: string }>;
  searchParams: Promise<{ sekme?: string; aralik?: string; baslangic?: string; bitis?: string; grafik?: string }>;
}) {
  const { siteId: rawId } = await params;
  const sp = await searchParams;
  const siteId = Number(rawId);
  if (!Number.isInteger(siteId)) notFound();

  const tab = resolveTab(sp.sekme);
  const range = resolveRange(sp.aralik, todayInIstanbul(), sp.baslangic, sp.bitis);
  const chartType = sp.grafik === "gelir" ? "income" : "expense";
  const base = `/sites/${siteId}/raporlar`;

  const [, data] = await Promise.all([requireUser(), loadReport(siteId, tab, range.from, range.to)]);

  const rangeParams = {
    aralik: range.key === "ay" ? undefined : range.key,
    baslangic: range.key === "ozel" ? range.from : undefined,
    bitis: range.key === "ozel" ? range.to : undefined,
  };
  const exportHref = (format: "xlsx" | "pdf") => buildHref(`${base}/export`, { sekme: tab, ...rangeParams, format });

  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="flex items-center gap-2 text-xl font-semibold">
          <BarChart3 className="size-5 text-muted-foreground" aria-hidden />
          Raporlar
        </h1>
        <div className="flex gap-2">
          <a
            href={exportHref("xlsx")}
            download
            className="inline-flex min-h-11 items-center gap-2 rounded-lg border px-3 text-sm font-medium hover:bg-muted"
            aria-label={`${REPORT_TAB_LABELS[tab]} raporunu Excel olarak indir`}
          >
            <FileSpreadsheet className="size-4" aria-hidden />
            Excel
          </a>
          <a
            href={exportHref("pdf")}
            download
            className="inline-flex min-h-11 items-center gap-2 rounded-lg border px-3 text-sm font-medium hover:bg-muted"
            aria-label={`${REPORT_TAB_LABELS[tab]} raporunu PDF olarak indir`}
          >
            <FileText className="size-4" aria-hidden />
            PDF
          </a>
        </div>
      </div>

      <RangeFilter base={base} range={range} keep={{ sekme: sp.sekme, grafik: sp.grafik }} />

      <nav aria-label="Rapor sekmeleri" className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
        <div className="inline-flex rounded-lg bg-muted p-1">
          {REPORT_TABS.map((t) => (
            <Link
              key={t}
              href={buildHref(base, { ...rangeParams, sekme: t === "trend" ? undefined : t, grafik: sp.grafik })}
              scroll={false}
              aria-current={tab === t ? "page" : undefined}
              className={cn(
                "inline-flex min-h-11 shrink-0 items-center whitespace-nowrap rounded-md px-3.5 text-sm font-medium",
                tab === t ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {REPORT_TAB_LABELS[t]}
            </Link>
          ))}
        </div>
      </nav>

      {data.tab === "trend" && (
        <section className="space-y-4" aria-label="Genel trend">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <SummaryCard label="Toplam Gelir" value={data.income} icon={TrendingUp} tone="text-emerald-700 dark:text-emerald-400" />
            <SummaryCard label="Toplam Gider" value={data.expense} icon={TrendingDown} tone="text-orange-700 dark:text-orange-400" />
            <SummaryCard
              label="Net"
              value={data.income - data.expense}
              icon={Scale}
              tone={data.income - data.expense >= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}
              className="col-span-2 sm:col-span-1"
            />
          </div>
          {data.income === 0 && data.expense === 0 ? (
            <Empty text="Bu dönemde gelir veya gider kaydı yok." />
          ) : (
            <div className="rounded-xl border bg-card p-3 sm:p-4">
              <p className="mb-2 text-xs text-muted-foreground">{data.bucket === "day" ? "Günlük" : "Aylık"} gelir ve gider</p>
              <TrendChart points={data.points} bucket={data.bucket} />
            </div>
          )}
        </section>
      )}

      {data.tab === "kategori" && (
        <section className="space-y-3 rounded-xl border bg-card p-4" aria-label="Kategori dağılımı">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold">Kategori dağılımı</h2>
            <div role="group" aria-label="Grafik türü" className="inline-flex rounded-lg bg-muted p-1">
              {(["expense", "income"] as const).map((t) => (
                <Link
                  key={t}
                  href={buildHref(base, { ...rangeParams, sekme: "kategori", grafik: t === "expense" ? undefined : "gelir" })}
                  scroll={false}
                  aria-pressed={chartType === t}
                  className={cn(
                    "inline-flex min-h-11 items-center rounded-md px-3.5 text-sm font-medium",
                    chartType === t ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {t === "expense" ? "Gider" : "Gelir"}
                </Link>
              ))}
            </div>
          </div>
          <CategoryList
            rows={chartType === "income" ? data.income : data.expense}
            type={chartType}
            siteId={siteId}
            rangeParams={rangeParams}
          />
        </section>
      )}

      {data.tab === "cari" && (
        <section className="space-y-2" aria-label="Cari bazlı">
          <p className="text-xs text-muted-foreground">
            Faturalanan / ödenen / tahsil edilen seçili döneme aittir; kalan borç tüm zamanların toplamıdır (faturalanan − ödenen). En çok kalan borcu olan başta.
          </p>
          {data.rows.length === 0 ? (
            <Empty text="Bu dönemde cari hareketi veya irsaliye tutarı yok." />
          ) : (
            <div className="divide-y rounded-xl border bg-card">
              {data.rows.map((r) => (
                <DataRow
                  key={r.partyId}
                  href={`/sites/${siteId}/cari/${r.partyId}`}
                  title={r.name}
                  badge={<CategoryBadge category={r.category} />}
                  lines={[
                    [r.invoiced > 0 && `Fatura ${formatCurrency(r.invoiced)}`, r.paid > 0 && `Ödenen ${formatCurrency(r.paid)}`, r.collected > 0 && `Tahsilat ${formatCurrency(r.collected)}`]
                      .filter(Boolean)
                      .join(" · "),
                  ]}
                  trailing={
                    <span className="block text-right text-xs text-muted-foreground">
                      {r.remaining >= 0 ? "Kalan borç" : "Fazla ödeme"}
                      <span className={cn("block text-sm font-semibold tabular-nums", r.remaining > 0 ? "text-red-600 dark:text-red-400" : "text-foreground")}>
                        {formatCurrency(Math.abs(r.remaining))}
                      </span>
                    </span>
                  }
                />
              ))}
            </div>
          )}
        </section>
      )}

      {data.tab === "personel" && (
        <section className="space-y-2" aria-label="Personel bazlı">
          <p className="text-xs text-muted-foreground">Seçili dönemde en çok çalışandan başlayarak çalışılan gün (puantaj) ve ödenen tutar.</p>
          {data.rows.length === 0 ? (
            <Empty text="Bu dönemde puantaj veya maaş ödemesi yok." />
          ) : (
            <div className="divide-y rounded-xl border bg-card">
              {data.rows.map((r) => (
                <DataRow
                  key={r.personnelId}
                  href={`/sites/${siteId}/personel/${r.personnelId}`}
                  title={r.name}
                  lines={[`${r.days} gün çalıştı`]}
                  trailing={
                    r.paid > 0 ? (
                      <span className="block text-right text-xs text-muted-foreground">
                        Ödenen
                        <span className="block text-sm font-semibold tabular-nums text-orange-700 dark:text-orange-400">{formatCurrency(r.paid)}</span>
                      </span>
                    ) : undefined
                  }
                />
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">{text}</p>;
}

function SummaryCard({
  label,
  value,
  icon: Icon,
  tone,
  className,
}: {
  label: string;
  value: number;
  icon: typeof TrendingUp;
  tone: string;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0 rounded-xl border bg-card p-3 sm:p-4", className)}>
      <div className="mb-2 flex items-center gap-2 text-sm text-muted-foreground">
        <Icon className="size-4 shrink-0" aria-hidden />
        {label}
      </div>
      <p className={cn("text-lg font-semibold tabular-nums sm:text-xl", tone)}>{formatCurrency(value)}</p>
    </div>
  );
}

/** Halka grafik + renkli noktalı liste; bir satıra dokunmak Genel Kasa'yı o kategori ve döneme süzer. */
function CategoryList({
  rows,
  type,
  siteId,
  rangeParams,
}: {
  rows: CategoryRow[];
  type: "income" | "expense";
  siteId: number;
  rangeParams: Record<string, string | undefined>;
}) {
  if (rows.length === 0) return <Empty text={`Bu dönemde ${type === "income" ? "gelir" : "gider"} kaydı yok.`} />;
  const total = rows.reduce((s, r) => s + r.total, 0);
  return (
    <div className="space-y-3">
      <CategoryPie rows={rows} type={type} />
      <ul className="space-y-0.5">
        {rows.map((r, i) => {
          const pct = total > 0 ? Math.round((r.total / total) * 100) : 0;
          const inner = (
            <span className="flex items-center gap-3 text-sm">
              <span className="size-3 shrink-0 rounded-full" style={{ background: pieColor(type, i) }} aria-hidden />
              <span className="min-w-0 flex-1 truncate">{r.name}</span>
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {formatCurrency(r.total)} · %{pct}
              </span>
            </span>
          );
          return (
            <li key={r.categoryId ?? "kategorisiz"}>
              {r.categoryId !== null ? (
                <Link
                  href={buildHref(`/sites/${siteId}/kasa`, { ...rangeParams, tur: type === "income" ? "gelir" : "gider", kategori: String(r.categoryId) })}
                  className="flex min-h-11 items-center rounded-lg px-2 hover:bg-muted/50"
                  aria-label={`${r.name}: ${formatCurrency(r.total)}, yüzde ${pct}. Kasada bu kategoriyi göster`}
                >
                  {inner}
                </Link>
              ) : (
                <div className="flex min-h-11 items-center px-2">{inner}</div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
