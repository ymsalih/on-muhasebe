import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getCashSummary, listCategories } from "@/lib/cash/queries";
import { listPartyBalances } from "@/lib/parties/queries";
import { addDays, daysBetween } from "@/lib/personnel/status";
import type { PartyCategory } from "@/lib/goods/schemas";

export const REPORT_TABS = ["trend", "kategori", "cari", "personel"] as const;
export type ReportTab = (typeof REPORT_TABS)[number];
export const REPORT_TAB_LABELS: Record<ReportTab, string> = {
  trend: "Genel Trend",
  kategori: "Kategori Dağılımı",
  cari: "Cari Bazlı",
  personel: "Personel Bazlı",
};

/** Adres parametresinden sekme; geçersizse Genel Trend. */
export function resolveTab(param: string | undefined): ReportTab {
  return (REPORT_TABS.find((t) => t === param) ?? "trend") as ReportTab;
}

/** Bu günden uzun aralıklar aylık kırılımda gösterilir (grafik okunaklı kalsın). */
const DAILY_MAX_DAYS = 62;

export type TrendPoint = { period: string; income: number; expense: number };
export type TrendData = { tab: "trend"; bucket: "day" | "month"; points: TrendPoint[]; income: number; expense: number };

function nextMonth(iso: string): string {
  const [y, m] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
}

export async function getTrend(siteId: number, from: string, to: string): Promise<TrendData> {
  const bucket = daysBetween(from, to) + 1 > DAILY_MAX_DAYS ? "month" : "day";
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_cash_trend", { p_site_id: siteId, p_from: from, p_to: to, p_bucket: bucket });
  if (error) throw new Error("get_cash_trend okunamadı");

  const byPeriod = new Map(
    ((data ?? []) as { period: string; income: number | string; expense: number | string }[]).map((r) => [r.period, r]),
  );
  // Hareketsiz günler/aylar grafikte sıfır olarak görünsün
  const periods: string[] = [];
  if (bucket === "day") {
    for (let d = from; d <= to; d = addDays(d, 1)) periods.push(d);
  } else {
    for (let m = `${from.slice(0, 7)}-01`; m <= to; m = nextMonth(m)) periods.push(m);
  }
  const points = periods.map((period) => ({
    period,
    income: Number(byPeriod.get(period)?.income ?? 0),
    expense: Number(byPeriod.get(period)?.expense ?? 0),
  }));
  return {
    tab: "trend",
    bucket,
    points,
    income: points.reduce((s, p) => s + p.income, 0),
    expense: points.reduce((s, p) => s + p.expense, 0),
  };
}

export type CategoryRow = { categoryId: number | null; name: string; total: number };
export type CategoryData = { tab: "kategori"; income: CategoryRow[]; expense: CategoryRow[]; incomeTotal: number; expenseTotal: number };

export async function getCategoryReport(siteId: number, from: string, to: string): Promise<CategoryData> {
  const [summary, categories] = await Promise.all([getCashSummary(siteId, from, to), listCategories(siteId)]);
  const names = new Map(categories.map((c) => [c.id, c.name]));
  const rows = (type: "income" | "expense"): CategoryRow[] =>
    summary.byCategory
      .filter((r) => r.type === type)
      .map((r) => ({ categoryId: r.category_id, name: r.category_id === null ? "Kategorisiz" : (names.get(r.category_id) ?? "Silinmiş kategori"), total: r.total }))
      .sort((a, b) => b.total - a.total);
  return { tab: "kategori", income: rows("income"), expense: rows("expense"), incomeTotal: summary.income, expenseTotal: summary.expense };
}

export type PartyReportRow = {
  partyId: number;
  name: string;
  category: PartyCategory;
  invoiced: number;
  paid: number;
  collected: number;
  /** Tüm zamanların kalan borcu: faturalanan − ödenen (dönemden bağımsız) */
  remaining: number;
};
export type PartyData = { tab: "cari"; rows: PartyReportRow[] };

export async function getPartyReport(siteId: number, from: string, to: string): Promise<PartyData> {
  const supabase = await createClient();
  const [{ data, error }, balances] = await Promise.all([
    supabase.rpc("get_party_report", { p_site_id: siteId, p_from: from, p_to: to }),
    listPartyBalances(siteId),
  ]);
  if (error) throw new Error("get_party_report okunamadı");
  const remaining = new Map(balances.map((b) => [b.party_id, b.total_invoiced - b.total_expense]));
  const rows = (
    (data ?? []) as { party_id: number; name: string; category: PartyCategory; invoiced: number | string; paid: number | string; collected: number | string }[]
  ).map((r) => ({
    partyId: r.party_id,
    name: r.name,
    category: r.category,
    invoiced: Number(r.invoiced),
    paid: Number(r.paid),
    collected: Number(r.collected),
    remaining: remaining.get(r.party_id) ?? 0,
  }));
  // En çok kalan borcu olan başta
  rows.sort((a, b) => b.remaining - a.remaining || a.name.localeCompare(b.name, "tr"));
  return { tab: "cari", rows };
}

export type PersonnelReportRow = { personnelId: number; name: string; days: number; paid: number };
export type PersonnelData = { tab: "personel"; rows: PersonnelReportRow[] };

export async function getPersonnelReport(siteId: number, from: string, to: string): Promise<PersonnelData> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_personnel_report", { p_site_id: siteId, p_from: from, p_to: to });
  if (error) throw new Error("get_personnel_report okunamadı");
  const rows = ((data ?? []) as { personnel_id: number; full_name: string; days_worked: number; paid: number | string }[]).map((r) => ({
    personnelId: r.personnel_id,
    name: r.full_name,
    days: r.days_worked,
    paid: Number(r.paid),
  }));
  return { tab: "personel", rows };
}

export type ReportData = TrendData | CategoryData | PartyData | PersonnelData;

export async function loadReport(siteId: number, tab: ReportTab, from: string, to: string): Promise<ReportData> {
  switch (tab) {
    case "trend":
      return getTrend(siteId, from, to);
    case "kategori":
      return getCategoryReport(siteId, from, to);
    case "cari":
      return getPartyReport(siteId, from, to);
    case "personel":
      return getPersonnelReport(siteId, from, to);
  }
}
