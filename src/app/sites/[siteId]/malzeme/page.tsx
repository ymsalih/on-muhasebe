import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FileSpreadsheet, FileText, ListChecks, Package, Wallet } from "lucide-react";
import { MaterialEntries } from "@/components/materials/material-entries";
import { RangeFilter, buildHref } from "@/components/cash/range-filter";
import { requireUser } from "@/lib/auth/session";
import { resolveRange } from "@/lib/cash/range";
import { formatCurrency, formatNumber } from "@/lib/format";
import { ENTRY_LIST_LIMIT, getCostBreakdown, getSuggestions, listMaterialEntries, type BreakdownRow } from "@/lib/materials/queries";
import type { Breakdown } from "@/lib/materials/schemas";
import { todayInIstanbul } from "@/lib/personnel/status";
import { canWriteRole, getSiteRole } from "@/lib/sites/queries";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Malzeme — Şantiye Ön Muhasebe" };

type ViewKey = "giris" | "ortak" | "malzeme" | "kullanim";
const VIEWS: { key: ViewKey; label: string; by?: Breakdown }[] = [
  { key: "giris", label: "Girişler" },
  { key: "ortak", label: "Ortak Bazında", by: "partner" },
  { key: "malzeme", label: "Malzeme Bazında", by: "item" },
  { key: "kullanim", label: "Kullanım Yeri", by: "usage" },
];
const EMPTY_TEXT: Record<Breakdown, string> = {
  partner: "Bu dönemde malzeme girişi yok.",
  item: "Bu dönemde malzeme girişi yok.",
  usage: "Bu dönemde malzeme girişi yok.",
};
const HINT: Record<Breakdown, string> = {
  partner: "Her ortağın bu şantiyede girdiği malzemelerin toplam maliyeti.",
  item: "Aynı ad, cins ve birimdeki girişler birleştirilir. En pahalıdan başlar.",
  usage: "Malzemelerin nerede/ne için kullanıldığına göre maliyet. Kullanım yeri girilmemiş girişler “Belirtilmemiş” altında toplanır.",
};

/** Malzeme girişleri: alınan malzemenin maliyeti ve nerede kullanıldığı. Şantiye bazlı; toplamlar ortak bazında da ayrı görünür. Genel kasadan bağımsızdır. */
export default async function MaterialsPage({
  params,
  searchParams,
}: {
  params: Promise<{ siteId: string }>;
  searchParams: Promise<{ gorunum?: string; aralik?: string; baslangic?: string; bitis?: string }>;
}) {
  const { siteId: rawId } = await params;
  const sp = await searchParams;
  const siteId = Number(rawId);
  if (!Number.isInteger(siteId)) notFound();

  const today = todayInIstanbul();
  const range = resolveRange(sp.aralik, today, sp.baslangic, sp.bitis);
  const current = VIEWS.find((v) => v.key === sp.gorunum) ?? VIEWS[0];
  const base = `/sites/${siteId}/malzeme`;

  // Tüm veri kimlik doğrulamayla birlikte (paralel) istenir. Üst kartlar için ortak kırılımı her zaman gelir.
  const [, role, perPartner, extra, list, suggestions] = await Promise.all([
    requireUser(),
    getSiteRole(siteId),
    getCostBreakdown(siteId, range.from, range.to, "partner"),
    current.by && current.by !== "partner" ? getCostBreakdown(siteId, range.from, range.to, current.by) : Promise.resolve(null),
    current.key === "giris" ? listMaterialEntries(siteId, range.from, range.to) : Promise.resolve({ rows: [], hasMore: false }),
    current.key === "giris" ? getSuggestions(siteId) : Promise.resolve({ names: [], variants: [], units: [], suppliers: [], usages: [] }),
  ]);
  const canWrite = canWriteRole(role);
  const totalCost = perPartner.reduce((s, r) => s + r.total, 0);
  const totalCount = perPartner.reduce((s, r) => s + r.count, 0);
  const rows: BreakdownRow[] | null = current.by === "partner" ? perPartner : extra;

  const rangeParams = {
    aralik: range.key === "ay" ? undefined : range.key,
    baslangic: range.key === "ozel" ? range.from : undefined,
    bitis: range.key === "ozel" ? range.to : undefined,
  };
  const exportHref = (format: "xlsx" | "pdf") => buildHref(`${base}/export`, { gorunum: current.key === "giris" ? undefined : current.key, ...rangeParams, format });

  const cards = [
    { label: "Toplam malzeme maliyeti", value: formatCurrency(totalCost), icon: Wallet, tone: "text-foreground" },
    { label: "Giriş sayısı", value: String(totalCount), icon: ListChecks, tone: "text-foreground" },
  ];

  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="flex items-center gap-2 text-xl font-semibold">
          <Package className="size-5 text-muted-foreground" aria-hidden />
          Malzeme
        </h1>
        {totalCount > 0 && (
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

      <RangeFilter base={base} range={range} keep={{ gorunum: sp.gorunum }} />

      <section aria-label="Malzeme toplamları" className="grid grid-cols-2 gap-3">
        {cards.map(({ label, value, icon: Icon, tone }) => (
          <div key={label} className="min-w-0 rounded-xl border bg-card p-3 sm:p-4">
            <div className="mb-2 flex items-center gap-2 text-sm text-muted-foreground">
              <Icon className="size-4 shrink-0" aria-hidden />
              {label}
            </div>
            <p className={cn("text-lg font-semibold tabular-nums sm:text-xl", tone)}>{value}</p>
          </div>
        ))}
      </section>
      <p className="-mt-2 text-xs text-muted-foreground">Bu şantiyenin toplamıdır; genel kasadan bağımsızdır. Maliyet = miktar × birim fiyat.</p>

      <nav aria-label="Malzeme sekmeleri" className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
        <div className="inline-flex rounded-lg bg-muted p-1">
          {VIEWS.map((v) => (
            <Link
              key={v.key}
              href={buildHref(base, { ...rangeParams, gorunum: v.key === "giris" ? undefined : v.key })}
              scroll={false}
              aria-current={current.key === v.key ? "page" : undefined}
              className={cn("inline-flex min-h-11 shrink-0 items-center whitespace-nowrap rounded-md px-3.5 text-sm font-medium", current.key === v.key ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground")}
            >
              {v.label}
            </Link>
          ))}
        </div>
      </nav>

      {current.key === "giris" ? (
        <MaterialEntries siteId={siteId} canWrite={canWrite} today={today} entries={list.rows} hasMore={list.hasMore || list.rows.length > ENTRY_LIST_LIMIT} suggestions={suggestions} />
      ) : (
        <section className="space-y-2" aria-label={current.label}>
          <p className="text-xs text-muted-foreground">{HINT[current.by!]}</p>
          {!rows || rows.length === 0 ? (
            <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">{EMPTY_TEXT[current.by!]}</p>
          ) : (
            <ul className="divide-y rounded-xl border bg-card">
              {rows.map((r) => {
                const pct = totalCost > 0 ? Math.round((r.total / totalCost) * 100) : 0;
                return (
                  <li key={r.key || "belirtilmemis"} className="px-4 py-3">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="min-w-0 truncate text-sm font-medium">{r.label}</span>
                      <span className="shrink-0 text-sm font-semibold tabular-nums">{formatCurrency(r.total)}</span>
                    </div>
                    <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
                      <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(2, pct)}%` }} />
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {r.count} giriş{r.quantity !== null && ` · ${formatNumber(r.quantity)} ${r.unit ?? ""}`} · %{pct}
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
