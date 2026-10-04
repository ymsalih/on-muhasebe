import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BarChart3, Banknote, BookUser, Droplets, FileSpreadsheet, FileText, Fuel, Package, Receipt, Scale, TrendingDown, TrendingUp, Truck, Users, Wallet, type LucideIcon } from "lucide-react";
import { DataRow } from "@/components/data-row";
import { CategoryPie } from "@/components/reports/category-pie";
import { TabStrip } from "@/components/reports/tab-strip";
import { TrendChart } from "@/components/reports/trend-chart";
import { RangeFilter, buildHref } from "@/components/cash/range-filter";
import { CategoryBadge } from "@/components/parties/balance";
import { requireUser } from "@/lib/auth/session";
import { resolveRange } from "@/lib/cash/range";
import { formatCurrency, formatNumber } from "@/lib/format";
import { todayInIstanbul } from "@/lib/personnel/status";
import { pieColor } from "@/lib/reports/colors";
import { periodLabel } from "@/lib/reports/labels";
import { REPORT_TABS, REPORT_TAB_LABELS, loadReport, resolveTab, type CategoryRow } from "@/lib/reports/queries";
import type { BreakdownRow } from "@/lib/materials/queries";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Raporlar — ÖZN YOL" };

/**
 * Raporlar (CLAUDE.md 7.3-I): dönem seçici + Genel Özet (şantiyenin tüm bilgileri) / Genel Trend / Kategori / Cari / Personel /
 * Malzeme / Yakıt / Makine / Hakediş-Fatura. Her sekmede PDF/Excel; Genel Özet'te Excel tüm kayıtları sayfa sayfa içerir.
 * Ortağa özel veriler (malzeme, yakıt, makine, hakediş/fatura) ortakta yalnızca kendi kayıtlarını, adminde hepsini gösterir.
 */
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

  const [profile, data] = await Promise.all([requireUser(), loadReport(siteId, tab, range.from, range.to)]);
  const isAdmin = profile.role === "admin";

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
            aria-label={tab === "ozet" ? "Şantiyenin dönemdeki tüm kayıtlarını çok sayfalı Excel olarak indir" : `${REPORT_TAB_LABELS[tab]} raporunu Excel olarak indir`}
            data-testid="export-xlsx"
          >
            <FileSpreadsheet className="size-4" aria-hidden />
            {tab === "ozet" ? "Excel (tüm veri)" : "Excel"}
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

      <TabStrip label="Rapor sekmeleri">
        {REPORT_TABS.map((t) => (
            <Link
              key={t}
              href={buildHref(base, { ...rangeParams, sekme: t === "ozet" ? undefined : t, grafik: sp.grafik })}
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
      </TabStrip>

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

      {data.tab === "ozet" && (
        <section className="space-y-4" aria-label="Genel özet">
          <p className="text-sm text-muted-foreground">
            Şantiyenin seçili dönemdeki tüm rakamları tek ekranda. Bir kartın bağlantısı ilgili ayrıntıya götürür; “Excel (tüm veri)” dönemdeki tüm kayıtları
            sayfa sayfa (kasa, cari, personel, puantaj, irsaliye, malzeme, yakıt, makine, hakediş, fatura) indirir — kendi analizleriniz için.
          </p>
          <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
            {isAdmin
              ? "Malzeme, yakıt, makine ve hakediş/fatura her ortağa özeldir; burada tüm ortakların toplamı görünür (salt görüntüleme)."
              : "Malzeme, yakıt, makine ve hakediş/fatura her ortağa özeldir; burada yalnızca sizin kayıtlarınız toplanır."}
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <OverviewCard
              title="Kasa"
              icon={Wallet}
              href={buildHref(`/sites/${siteId}/kasa`, rangeParams)}
              linkLabel="Genel Kasa"
              items={[
                { label: "Gelir", value: formatCurrency(data.n.cashIncome), tone: "text-emerald-700 dark:text-emerald-400" },
                { label: "Gider", value: formatCurrency(data.n.cashExpense), tone: "text-orange-700 dark:text-orange-400" },
                { label: "Net", value: formatCurrency(data.n.cashIncome - data.n.cashExpense), tone: data.n.cashIncome - data.n.cashExpense >= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-red-600 dark:text-red-400" },
                { label: "Hareket", value: `${formatNumber(data.n.cashCount)} kayıt` },
              ]}
            />
            <OverviewCard
              title="Personel ve maaş"
              icon={Users}
              href={buildHref(base, { ...rangeParams, sekme: "personel" })}
              linkLabel="Personel raporu"
              items={[
                { label: "Çalışılan gün (puantaj)", value: formatNumber(data.n.attendanceDays) },
                { label: "Çalışan kişi", value: formatNumber(data.n.attendancePeople) },
                { label: "Ödenen maaş", value: formatCurrency(data.n.wagePaid), tone: "text-orange-700 dark:text-orange-400" },
                { label: "Kayıtlı personel", value: formatNumber(data.n.personnelTotal) },
              ]}
            />
            <OverviewCard
              title="İrsaliye / Fatura / Fiş"
              icon={FileText}
              href={`/sites/${siteId}/irsaliye`}
              linkLabel="İrsaliyeler"
              items={[
                { label: "Kayıt", value: formatNumber(data.n.goodsCount) },
                { label: "Tutar (fiyatı girilenler)", value: formatCurrency(data.n.goodsTotal) },
                { label: "Nakliye", value: formatCurrency(data.n.goodsTransport) },
              ]}
            />
            <OverviewCard
              title="Malzeme"
              icon={Package}
              href={buildHref(base, { ...rangeParams, sekme: "malzeme" })}
              linkLabel="Malzeme raporu"
              items={[
                { label: "Giriş", value: formatNumber(data.n.materialCount) },
                { label: "Maliyet", value: formatCurrency(data.n.materialTotal), tone: "text-orange-700 dark:text-orange-400" },
              ]}
            />
            <OverviewCard
              title="Yakıt"
              icon={Fuel}
              href={buildHref(base, { ...rangeParams, sekme: "yakit" })}
              linkLabel="Yakıt raporu"
              items={[
                { label: "Alım", value: formatNumber(data.n.fuelCount) },
                { label: "Litre", value: `${formatNumber(data.n.fuelLiters)} L` },
                { label: "Tutar", value: formatCurrency(data.n.fuelTotal), tone: "text-orange-700 dark:text-orange-400" },
              ]}
            />
            <OverviewCard
              title="İş makineleri"
              icon={Truck}
              href={buildHref(base, { ...rangeParams, sekme: "makine" })}
              linkLabel="Makine raporu"
              items={[
                { label: "Çalışılan gün", value: formatNumber(data.n.machineDays) },
                { label: "Çalışılan saat", value: formatNumber(data.n.machineHours) },
                { label: "Ödenen kira", value: formatCurrency(data.n.rentPaid), tone: "text-orange-700 dark:text-orange-400" },
              ]}
            />
            <OverviewCard
              title="Hakediş ve fatura"
              icon={Receipt}
              href={buildHref(base, { ...rangeParams, sekme: "hakedis" })}
              linkLabel="Hakediş raporu"
              items={[
                { label: "Dönem hakediş", value: formatCurrency(data.n.progressTotal), tone: "text-emerald-700 dark:text-emerald-400" },
                { label: "Dönem fatura", value: formatCurrency(data.n.invoiceTotal), tone: "text-orange-700 dark:text-orange-400" },
                { label: "Kalan (tüm zamanlar)", value: formatCurrency(data.n.progressAll - data.n.invoiceAll), tone: data.n.progressAll - data.n.invoiceAll >= 0 ? "" : "text-red-600 dark:text-red-400" },
              ]}
            />
            <OverviewCard
              title="Cariler"
              icon={BookUser}
              href={buildHref(base, { ...rangeParams, sekme: "cari" })}
              linkLabel="Cari raporu"
              items={[
                { label: "Cari sayısı", value: formatNumber(data.n.partyCount) },
                { label: "Borçlu cari", value: formatNumber(data.partyDebtCount) },
                { label: "Toplam kalan borç", value: formatCurrency(data.partyDebt), tone: data.partyDebt > 0 ? "text-red-600 dark:text-red-400" : "" },
              ]}
            />
          </div>
        </section>
      )}

      {data.tab === "malzeme" && (
        <section className="space-y-4" aria-label="Malzeme">
          <div className="grid grid-cols-2 gap-3">
            <SummaryCard label="Toplam malzeme maliyeti" value={data.total} icon={Package} tone="text-orange-700 dark:text-orange-400" />
            <CountCard label="Giriş sayısı" value={formatNumber(data.count)} icon={Receipt} />
          </div>
          <p className="text-xs text-muted-foreground">
            Maliyet = miktar × birim fiyat. {isAdmin ? "Tüm ortakların girdikleri toplanır." : "Yalnızca sizin girdiğiniz malzemeler."} Genel kasadan bağımsızdır.
          </p>
          {data.count === 0 ? (
            <Empty text="Bu dönemde malzeme girişi yok." />
          ) : (
            <>
              {isAdmin && <BreakdownCard title="Ortak bazında" rows={data.partner} total={data.total} />}
              <BreakdownCard title="Malzeme bazında" rows={data.item} total={data.total} />
              <BreakdownCard title="Kullanım yeri bazında" rows={data.usage} total={data.total} />
            </>
          )}
        </section>
      )}

      {data.tab === "yakit" && (
        <section className="space-y-4" aria-label="Yakıt">
          <div className="grid grid-cols-3 gap-2 sm:gap-3">
            <SummaryCard label="Toplam tutar" value={data.total} icon={Wallet} tone="text-orange-700 dark:text-orange-400" />
            <CountCard label="Toplam litre" value={`${formatNumber(data.liters)} L`} icon={Droplets} />
            <SummaryCard label="Ort. litre fiyatı" value={data.liters > 0 ? data.total / data.liters : 0} icon={Fuel} tone="" />
          </div>
          <p className="text-xs text-muted-foreground">Araç bazında; en çok yakıt tutarı olan başta. Satıra dokunmak yakıt kayıtlarını o araca süzer.</p>
          {data.rows.length === 0 ? (
            <Empty text="Bu dönemde yakıt kaydı yok." />
          ) : (
            <div className="divide-y rounded-xl border bg-card">
              {data.rows.map((r) => (
                <DataRow
                  key={`${r.ownerId}-${r.machineId}`}
                  href={buildHref(`/sites/${siteId}/yakit`, { ...rangeParams, arac: String(r.machineId), ortak: isAdmin ? r.ownerId : undefined })}
                  title={r.identifier ? `${r.machineName} · ${r.identifier}` : r.machineName}
                  lines={[`${r.count} alım · ${formatNumber(r.liters)} L · ort. ${formatCurrency(r.liters > 0 ? r.total / r.liters : 0)}/L`, isAdmin ? `Ortak: ${r.ownerName}` : null]}
                  trailing={<span className="text-sm font-semibold tabular-nums text-orange-700 dark:text-orange-400">{formatCurrency(r.total)}</span>}
                />
              ))}
            </div>
          )}
        </section>
      )}

      {data.tab === "makine" && (
        <section className="space-y-4" aria-label="Makine">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
            <CountCard label="Çalışılan gün" value={formatNumber(data.days)} icon={Truck} />
            <CountCard label="Çalışılan saat" value={formatNumber(data.hours)} icon={Truck} />
            <SummaryCard label="Hesaplanan kira" value={data.due} icon={Scale} tone="" />
            <SummaryCard label="Ödenen kira" value={data.paid} icon={Banknote} tone="text-orange-700 dark:text-orange-400" />
          </div>
          <p className="text-xs text-muted-foreground">
            Kira, kiralık makinede çalışılan gün/saat × birim kiradır; ödenen kira dönemdeki ödeme tarihine göredir. Kendi makinelerde yalnızca çalışma görünür.
          </p>
          {data.rows.length === 0 ? (
            <Empty text="Bu dönemde makine puantajı veya kira ödemesi yok." />
          ) : (
            <div className="divide-y rounded-xl border bg-card">
              {data.rows.map((r) => (
                <DataRow
                  key={`${r.ownerId}-${r.machineId}`}
                  href={buildHref(`/sites/${siteId}/makine`, { gorunum: "aylik", ortak: isAdmin ? r.ownerId : undefined })}
                  title={r.identifier ? `${r.name} · ${r.identifier}` : r.name}
                  lines={[
                    [`${r.days} gün`, r.hours > 0 && `${formatNumber(r.hours)} saat`, r.ownership === "rented" && r.rate !== null ? `${formatCurrency(r.rate)}/${r.rateUnit === "hour" ? "saat" : "gün"}` : "kendi makine"].filter(Boolean).join(" · "),
                    isAdmin ? `Ortak: ${r.ownerName}` : null,
                  ]}
                  trailing={
                    r.ownership === "rented" ? (
                      <span className="block text-right text-xs text-muted-foreground">
                        Ödenen / hesaplanan
                        <span className="block text-sm font-semibold tabular-nums">
                          <span className="text-orange-700 dark:text-orange-400">{formatCurrency(r.paid)}</span>
                          <span className="text-muted-foreground"> / {formatCurrency(r.due)}</span>
                        </span>
                      </span>
                    ) : undefined
                  }
                />
              ))}
            </div>
          )}
        </section>
      )}

      {data.tab === "hakedis" && (
        <section className="space-y-4" aria-label="Hakediş ve fatura">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
            <SummaryCard label="Dönem hakediş" value={data.progress} icon={TrendingUp} tone="text-emerald-700 dark:text-emerald-400" />
            <SummaryCard label="Dönem fatura" value={data.invoices} icon={TrendingDown} tone="text-orange-700 dark:text-orange-400" />
            <SummaryCard label="Dönem farkı" value={data.progress - data.invoices} icon={Scale} tone="" />
            <SummaryCard
              label="Kalan (tüm zamanlar)"
              value={data.progressAll - data.invoicesAll}
              icon={Receipt}
              tone={data.progressAll - data.invoicesAll >= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}
            />
          </div>
          <p className="text-xs text-muted-foreground">Kalan = toplam hakediş − toplam fatura (tüm zamanlar). Ay bazında satırlar seçili döneme aittir.</p>
          {data.months.length === 0 && data.owners.length === 0 ? (
            <Empty text="Bu dönemde hakediş veya fatura yok." />
          ) : (
            <>
              {data.months.length > 0 && (
                <div className="space-y-2">
                  <h2 className="text-sm font-semibold">Aylara göre</h2>
                  <div className="divide-y rounded-xl border bg-card">
                    {data.months.map((r) => (
                      <DataRow
                        key={`${r.ownerId}-${r.month}`}
                        href={`/sites/${siteId}/hakedis`}
                        title={periodLabel(r.month, "month")}
                        lines={[`Hakediş ${formatCurrency(r.progress)} · Fatura ${formatCurrency(r.invoices)}`, isAdmin ? `Ortak: ${r.ownerName}` : null]}
                        trailing={
                          <span className="block text-right text-xs text-muted-foreground">
                            Fark
                            <span className={cn("block text-sm font-semibold tabular-nums", r.progress - r.invoices < 0 && "text-red-600 dark:text-red-400")}>{formatCurrency(r.progress - r.invoices)}</span>
                          </span>
                        }
                      />
                    ))}
                  </div>
                </div>
              )}
              {data.owners.length > 0 && (
                <div className="space-y-2">
                  <h2 className="text-sm font-semibold">{isAdmin ? "Ortak başına kalan (tüm zamanlar)" : "Kalan (tüm zamanlar)"}</h2>
                  <div className="divide-y rounded-xl border bg-card">
                    {data.owners.map((r) => (
                      <DataRow
                        key={r.ownerId}
                        href={`/sites/${siteId}/hakedis${isAdmin ? `?ortak=${r.ownerId}` : ""}`}
                        title={r.ownerName}
                        lines={[`Hakediş ${formatCurrency(r.progress)} · Fatura ${formatCurrency(r.invoices)}`]}
                        trailing={
                          <span className="block text-right text-xs text-muted-foreground">
                            Kalan
                            <span className={cn("block text-sm font-semibold tabular-nums", r.progress - r.invoices < 0 ? "text-red-600 dark:text-red-400" : "text-emerald-700 dark:text-emerald-400")}>
                              {formatCurrency(r.progress - r.invoices)}
                            </span>
                          </span>
                        }
                      />
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </section>
      )}
    </div>
  );
}


function CountCard({ label, value, icon: Icon }: { label: string; value: string; icon: LucideIcon }) {
  return (
    <div className="min-w-0 rounded-xl border bg-card p-3 sm:p-4">
      <div className="mb-2 flex items-center gap-2 text-sm text-muted-foreground">
        <Icon className="size-4 shrink-0" aria-hidden />
        <span className="min-w-0">{label}</span>
      </div>
      <p className="break-words text-lg font-semibold tabular-nums sm:text-xl">{value}</p>
    </div>
  );
}

/** Genel özet kartı: başlık, birkaç rakam ve ilgili ayrıntıya bağlantı. */
function OverviewCard({
  title,
  icon: Icon,
  href,
  linkLabel,
  items,
}: {
  title: string;
  icon: LucideIcon;
  href: string;
  linkLabel: string;
  items: { label: string; value: string; tone?: string }[];
}) {
  return (
    <div className="flex min-w-0 flex-col rounded-xl border bg-card p-4" data-testid={`ozet-${title}`}>
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
        <Icon className="size-4 text-muted-foreground" aria-hidden />
        {title}
      </h2>
      <dl className="flex-1 space-y-2">
        {items.map((it) => (
          <div key={it.label} className="flex items-baseline justify-between gap-3">
            <dt className="min-w-0 text-sm text-muted-foreground">{it.label}</dt>
            <dd className={cn("shrink-0 text-sm font-semibold tabular-nums", it.tone)}>{it.value}</dd>
          </div>
        ))}
      </dl>
      <Link href={href} className="mt-3 inline-flex min-h-11 items-center text-sm font-medium text-primary hover:underline">
        {linkLabel} →
      </Link>
    </div>
  );
}

/** Malzeme maliyet kırılımı: çubuklu satırlar (Malzeme sayfasıyla aynı görünüm). */
function BreakdownCard({ title, rows, total }: { title: string; rows: BreakdownRow[]; total: number }) {
  return (
    <div className="space-y-2">
      <h2 className="text-sm font-semibold">{title}</h2>
      <ul className="divide-y rounded-xl border bg-card">
        {rows.map((r) => {
          const pct = total > 0 ? Math.round((r.total / total) * 100) : 0;
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
