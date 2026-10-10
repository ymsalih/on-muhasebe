import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getCostBreakdown, type BreakdownRow } from "@/lib/materials/queries";
import { remainingDebt } from "@/lib/parties/debt";
import { listPartyBalances } from "@/lib/parties/queries";

/**
 * Raporlar sayfasının yeni sekmeleri: genel özet, malzeme, yakıt, makine, hakediş/fatura.
 * Veri, çağıranın oturumuyla (RLS) okunur: ortağa özel tablolarda ortak yalnızca KENDİ kayıtlarını, admin hepsini görür.
 */
const n = (v: unknown) => Number(v ?? 0);

// ---------------------------------------------------------------- Genel özet
export type OverviewNumbers = {
  cashIncome: number;
  cashExpense: number;
  cashCount: number;
  wagePaid: number;
  rentPaid: number;
  personnelTotal: number;
  attendanceDays: number;
  attendancePeople: number;
  partyCount: number;
  goodsCount: number;
  goodsTotal: number;
  goodsTransport: number;
  materialCount: number;
  materialTotal: number;
  fuelCount: number;
  fuelLiters: number;
  fuelTotal: number;
  machineDays: number;
  machineHours: number;
  progressTotal: number;
  invoiceTotal: number;
  invoiceKdv: number;
  progressAll: number;
  invoiceAll: number;
};
export type OverviewData = { tab: "ozet"; n: OverviewNumbers; partyDebt: number; partyDebtCount: number };

export async function getOverview(siteId: number, from: string, to: string): Promise<OverviewData> {
  const supabase = await createClient();
  const [{ data, error }, balances] = await Promise.all([
    supabase.rpc("get_site_overview", { p_site_id: siteId, p_from: from, p_to: to }),
    listPartyBalances(siteId),
  ]);
  if (error || !data) throw new Error("get_site_overview okunamadı");
  const d = data as Record<string, unknown>;
  const debts = balances.map((b) => remainingDebt(b)).filter((v) => v > 0);
  return {
    tab: "ozet",
    n: {
      cashIncome: n(d.cash_income),
      cashExpense: n(d.cash_expense),
      cashCount: n(d.cash_count),
      wagePaid: n(d.wage_paid),
      rentPaid: n(d.rent_paid),
      personnelTotal: n(d.personnel_total),
      attendanceDays: n(d.attendance_days),
      attendancePeople: n(d.attendance_people),
      partyCount: n(d.party_count),
      goodsCount: n(d.goods_count),
      goodsTotal: n(d.goods_total),
      goodsTransport: n(d.goods_transport),
      materialCount: n(d.material_count),
      materialTotal: n(d.material_total),
      fuelCount: n(d.fuel_count),
      fuelLiters: n(d.fuel_liters),
      fuelTotal: n(d.fuel_total),
      machineDays: n(d.machine_days),
      machineHours: n(d.machine_hours),
      progressTotal: n(d.progress_total),
      invoiceTotal: n(d.invoice_total),
      invoiceKdv: n(d.invoice_kdv),
      progressAll: n(d.progress_all),
      invoiceAll: n(d.invoice_all),
    },
    partyDebt: debts.reduce((s, v) => s + v, 0),
    partyDebtCount: debts.length,
  };
}

// ---------------------------------------------------------------- Malzeme
export type MaterialData = { tab: "malzeme"; partner: BreakdownRow[]; item: BreakdownRow[]; usage: BreakdownRow[]; total: number; count: number };

export async function getMaterialReport(siteId: number, from: string, to: string): Promise<MaterialData> {
  const [partner, item, usage] = await Promise.all([
    getCostBreakdown(siteId, from, to, "partner"),
    getCostBreakdown(siteId, from, to, "item"),
    getCostBreakdown(siteId, from, to, "usage"),
  ]);
  return { tab: "malzeme", partner, item, usage, total: partner.reduce((s, r) => s + r.total, 0), count: partner.reduce((s, r) => s + r.count, 0) };
}

// ---------------------------------------------------------------- Yakıt
export type FuelReportRow = { ownerId: string; ownerName: string; machineId: number; machineName: string; identifier: string | null; count: number; liters: number; total: number };
export type FuelData = { tab: "yakit"; rows: FuelReportRow[]; liters: number; total: number; count: number };

export async function getFuelReport(siteId: number, from: string, to: string): Promise<FuelData> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_fuel_report", { p_site_id: siteId, p_from: from, p_to: to });
  if (error) throw new Error("get_fuel_report okunamadı");
  const rows = ((data ?? []) as { owner_id: string; owner_name: string; machine_id: number; machine_name: string; identifier: string | null; entry_count: number; liters: number | string; total: number | string }[]).map((r) => ({
    ownerId: r.owner_id,
    ownerName: r.owner_name,
    machineId: r.machine_id,
    machineName: r.machine_name,
    identifier: r.identifier,
    count: r.entry_count,
    liters: n(r.liters),
    total: n(r.total),
  }));
  return { tab: "yakit", rows, liters: rows.reduce((s, r) => s + r.liters, 0), total: rows.reduce((s, r) => s + r.total, 0), count: rows.reduce((s, r) => s + r.count, 0) };
}

// ---------------------------------------------------------------- Makine
export type MachineReportRow = {
  ownerId: string;
  ownerName: string;
  machineId: number;
  name: string;
  identifier: string | null;
  ownership: "own" | "rented";
  rateUnit: "day" | "hour" | null;
  rate: number | null;
  days: number;
  hours: number;
  due: number;
  paid: number;
};
export type MachineData = { tab: "makine"; rows: MachineReportRow[]; days: number; hours: number; due: number; paid: number };

export async function getMachineReport(siteId: number, from: string, to: string): Promise<MachineData> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_machine_report", { p_site_id: siteId, p_from: from, p_to: to });
  if (error) throw new Error("get_machine_report okunamadı");
  const rows = ((data ?? []) as {
    owner_id: string; owner_name: string; machine_id: number; machine_name: string; identifier: string | null; ownership: "own" | "rented";
    rate_unit: "day" | "hour" | null; rental_rate: number | string | null; days: number; hours: number | string; due: number | string; paid: number | string;
  }[]).map((r) => ({
    ownerId: r.owner_id,
    ownerName: r.owner_name,
    machineId: r.machine_id,
    name: r.machine_name,
    identifier: r.identifier,
    ownership: r.ownership,
    rateUnit: r.rate_unit,
    rate: r.rental_rate === null ? null : n(r.rental_rate),
    days: r.days,
    hours: n(r.hours),
    due: n(r.due),
    paid: n(r.paid),
  }));
  return {
    tab: "makine",
    rows,
    days: rows.reduce((s, r) => s + r.days, 0),
    hours: rows.reduce((s, r) => s + r.hours, 0),
    due: rows.reduce((s, r) => s + r.due, 0),
    paid: rows.reduce((s, r) => s + r.paid, 0),
  };
}

// ---------------------------------------------------------------- Hakediş / fatura
/** `invoices` = KDV hariç fatura; `kdv` = faturalardaki KDV */
export type BillingMonthRow = { ownerId: string; ownerName: string; month: string; progress: number; invoices: number; kdv: number };
export type BillingOwnerRow = { ownerId: string; ownerName: string; progress: number; invoices: number; kdv: number };
export type BillingData = {
  tab: "hakedis";
  months: BillingMonthRow[];
  owners: BillingOwnerRow[];
  /** Dönemdeki toplamlar */
  progress: number;
  invoices: number;
  /** Dönemdeki faturalarda toplam KDV */
  kdv: number;
  /** Tüm zamanların toplamı ve kalanı (hakediş − fatura) */
  progressAll: number;
  invoicesAll: number;
};

export async function getBillingReport(siteId: number, from: string, to: string): Promise<BillingData> {
  const supabase = await createClient();
  const [months, totals] = await Promise.all([
    supabase.rpc("get_billing_report", { p_site_id: siteId, p_from: from, p_to: to }),
    supabase.rpc("get_billing_totals", { p_site_id: siteId }),
  ]);
  if (months.error) throw new Error("get_billing_report okunamadı");
  if (totals.error) throw new Error("get_billing_totals okunamadı");
  const monthRows = ((months.data ?? []) as { owner_id: string; owner_name: string; month: string; progress: number | string; invoices: number | string; invoice_kdv: number | string }[]).map((r) => ({
    ownerId: r.owner_id,
    ownerName: r.owner_name,
    month: r.month,
    progress: n(r.progress),
    invoices: n(r.invoices),
    kdv: n(r.invoice_kdv),
  }));
  const owners = ((totals.data ?? []) as { owner_id: string; owner_name: string; progress: number | string; invoices: number | string; invoice_kdv: number | string }[]).map((r) => ({
    ownerId: r.owner_id,
    ownerName: r.owner_name,
    progress: n(r.progress),
    invoices: n(r.invoices),
    kdv: n(r.invoice_kdv),
  }));
  return {
    tab: "hakedis",
    months: monthRows,
    owners,
    progress: monthRows.reduce((s, r) => s + r.progress, 0),
    invoices: monthRows.reduce((s, r) => s + r.invoices, 0),
    kdv: monthRows.reduce((s, r) => s + r.kdv, 0),
    progressAll: owners.reduce((s, r) => s + r.progress, 0),
    invoicesAll: owners.reduce((s, r) => s + r.invoices, 0),
  };
}
