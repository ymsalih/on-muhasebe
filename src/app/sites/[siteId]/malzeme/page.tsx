import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowDownToLine, ArrowUpFromLine, FileSpreadsheet, FileText, Package, Warehouse } from "lucide-react";
import { MaterialsBoard, type BoardView } from "@/components/materials/materials-board";
import { RangeFilter, buildHref } from "@/components/cash/range-filter";
import { requireUser } from "@/lib/auth/session";
import { resolveRange } from "@/lib/cash/range";
import { formatCurrency } from "@/lib/format";
import { getMaterialSummary, listMovements, MOVEMENT_LIST_LIMIT } from "@/lib/materials/queries";
import { todayInIstanbul } from "@/lib/personnel/status";
import { canWriteRole, getSiteRole } from "@/lib/sites/queries";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Malzeme — Şantiye Ön Muhasebe" };

const VIEWS: { key: BoardView; label: string }[] = [
  { key: "stok", label: "Stok" },
  { key: "hareket", label: "Hareketler" },
  { key: "cikis", label: "Çıkış Raporu" },
];

/** Malzeme / stok defteri: stok durumu, giriş-çıkış hareketleri ve çıkış raporu. Şantiye bazlı; genel kasadan bağımsız. */
export default async function MaterialsPage({
  params,
  searchParams,
}: {
  params: Promise<{ siteId: string }>;
  searchParams: Promise<{ gorunum?: string; aralik?: string; baslangic?: string; bitis?: string; tur?: string }>;
}) {
  const { siteId: rawId } = await params;
  const sp = await searchParams;
  const siteId = Number(rawId);
  if (!Number.isInteger(siteId)) notFound();

  const today = todayInIstanbul();
  const range = resolveRange(sp.aralik, today, sp.baslangic, sp.bitis);
  const view: BoardView = sp.gorunum === "hareket" ? "hareket" : sp.gorunum === "cikis" ? "cikis" : "stok";
  const type = view === "cikis" ? "out" : view === "hareket" ? (sp.tur === "giris" ? "in" : sp.tur === "cikis" ? "out" : undefined) : undefined;
  const base = `/sites/${siteId}/malzeme`;

  // Tüm veri kimlik doğrulamayla birlikte (paralel) istenir.
  const [, role, summary, list] = await Promise.all([
    requireUser(),
    getSiteRole(siteId),
    getMaterialSummary(siteId, range.from, range.to),
    view === "stok" ? Promise.resolve({ rows: [], hasMore: false }) : listMovements(siteId, { from: range.from, to: range.to, type }),
  ]);
  const canWrite = canWriteRole(role);
  const { totals } = summary;

  const rangeParams = {
    aralik: range.key === "ay" ? undefined : range.key,
    baslangic: range.key === "ozel" ? range.from : undefined,
    bitis: range.key === "ozel" ? range.to : undefined,
  };
  const exportHref = (format: "xlsx" | "pdf") => buildHref(`${base}/export`, { gorunum: view === "cikis" ? "cikis" : "stok", ...rangeParams, format });
  const showExport = view !== "hareket" && summary.rows.length > 0;

  const cards = [
    { label: "Alınan (dönem)", value: totals.inAmount, icon: ArrowDownToLine, tone: "text-emerald-700 dark:text-emerald-400" },
    { label: "Çıkan (dönem)", value: totals.outAmount, icon: ArrowUpFromLine, tone: "text-orange-700 dark:text-orange-400" },
    { label: "Eldeki stok değeri", value: totals.stockValue, icon: Warehouse, tone: "text-foreground" },
  ];

  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="flex items-center gap-2 text-xl font-semibold">
          <Package className="size-5 text-muted-foreground" aria-hidden />
          Malzeme
        </h1>
        {showExport && (
          <div className="flex gap-2">
            <a href={exportHref("xlsx")} download className="inline-flex min-h-11 items-center gap-2 rounded-lg border px-3 text-sm font-medium hover:bg-muted" aria-label="Excel olarak indir">
              <FileSpreadsheet className="size-4" aria-hidden />
              Excel
            </a>
            <a href={exportHref("pdf")} download className="inline-flex min-h-11 items-center gap-2 rounded-lg border px-3 text-sm font-medium hover:bg-muted" aria-label="PDF olarak indir">
              <FileText className="size-4" aria-hidden />
              PDF
            </a>
          </div>
        )}
      </div>

      <RangeFilter base={base} range={range} keep={{ gorunum: sp.gorunum, tur: sp.tur }} />

      <section aria-label="Malzeme toplamları" className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {cards.map(({ label, value, icon: Icon, tone }, i) => (
          <div key={label} className={cn("min-w-0 rounded-xl border bg-card p-3 sm:p-4", i === 2 && "col-span-2 sm:col-span-1")}>
            <div className="mb-2 flex items-center gap-2 text-sm text-muted-foreground">
              <Icon className="size-4 shrink-0" aria-hidden />
              {label}
            </div>
            <p className={cn("text-lg font-semibold tabular-nums sm:text-xl", tone)}>{formatCurrency(value)}</p>
          </div>
        ))}
      </section>
      <p className="-mt-2 text-xs text-muted-foreground">
        Genel kasadan bağımsızdır. Çıkış tutarı = çıkış miktarı × ortalama alış fiyatı; stok değeri = eldeki miktar × ortalama alış fiyatı.
      </p>

      <nav aria-label="Malzeme sekmeleri" className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
        <div className="inline-flex rounded-lg bg-muted p-1">
          {VIEWS.map((v) => (
            <Link
              key={v.key}
              href={buildHref(base, { ...rangeParams, gorunum: v.key === "stok" ? undefined : v.key })}
              scroll={false}
              aria-current={view === v.key ? "page" : undefined}
              className={cn("inline-flex min-h-11 shrink-0 items-center whitespace-nowrap rounded-md px-3.5 text-sm font-medium", view === v.key ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground")}
            >
              {v.label}
            </Link>
          ))}
        </div>
      </nav>

      {view === "hareket" && (
        <nav aria-label="Türe göre filtre" className="inline-flex rounded-lg bg-muted p-1">
          {([undefined, "giris", "cikis"] as const).map((t) => (
            <Link
              key={t ?? "hepsi"}
              href={buildHref(base, { ...rangeParams, gorunum: "hareket", tur: t })}
              scroll={false}
              aria-current={(sp.tur ?? undefined) === t || (!sp.tur && !t) ? "true" : undefined}
              className={cn("inline-flex min-h-11 items-center rounded-md px-4 text-sm font-medium", (sp.tur ?? undefined) === t || (!sp.tur && !t) ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground")}
            >
              {t === "giris" ? "Giriş" : t === "cikis" ? "Çıkış" : "Tümü"}
            </Link>
          ))}
        </nav>
      )}

      <MaterialsBoard view={view} siteId={siteId} canWrite={canWrite} today={today} materials={summary.rows} movements={list.rows} hasMore={list.hasMore || list.rows.length > MOVEMENT_LIST_LIMIT} />
    </div>
  );
}
