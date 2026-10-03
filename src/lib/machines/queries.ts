import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { MachineStatus, MachineType, Ownership, RateUnit } from "@/lib/machines/schemas";

export type MachineRow = {
  id: number;
  name: string;
  machine_type: MachineType;
  identifier: string | null;
  ownership: Ownership;
  supplier: string | null;
  rate_unit: RateUnit | null;
  rental_rate: number | null;
  status: MachineStatus;
  start_date: string | null;
  end_date: string | null;
};

const MACHINE_COLUMNS = "id, name, machine_type, identifier, ownership, supplier, rate_unit, rental_rate, status, start_date, end_date";

/** Bir ortağın bu şantiyedeki makineleri. RLS: ortak yalnızca kendininkini, admin hepsini okur. */
export async function listMachines(siteId: number, ownerId: string): Promise<MachineRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("machines").select(MACHINE_COLUMNS).eq("site_id", siteId).eq("owner_id", ownerId).order("name").limit(500);
  if (error) throw new Error("machines okunamadı");
  return ((data ?? []) as unknown as MachineRow[]).map((m) => ({ ...m, rental_rate: m.rental_rate === null ? null : Number(m.rental_rate) }));
}

export type MachineOwner = { id: string; name: string };

/** Şantiyede makinesi olan ortaklar (admin seçicisi için; ortak yalnızca kendini görür). */
export async function getMachineOwners(siteId: number): Promise<MachineOwner[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_machine_owners", { p_site_id: siteId });
  if (error) throw new Error("get_machine_owners okunamadı");
  return ((data ?? []) as { owner_id: string; full_name: string }[]).map((r) => ({ id: r.owner_id, name: r.full_name }));
}

export type DayEntry = { hours: number | null; note: string | null };

/** Bir günün işaretli makineleri: makine id → saat ve not. */
export async function listDayAttendance(siteId: number, ownerId: string, date: string): Promise<Record<number, DayEntry>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("machine_attendance")
    .select("machine_id, hours, note")
    .eq("site_id", siteId)
    .eq("owner_id", ownerId)
    .eq("work_date", date);
  if (error) throw new Error("machine_attendance okunamadı");
  const out: Record<number, DayEntry> = {};
  for (const r of (data ?? []) as { machine_id: number; hours: number | string | null; note: string | null }[]) {
    out[r.machine_id] = { hours: r.hours === null ? null : Number(r.hours), note: r.note };
  }
  return out;
}

/** Bir ayın puantajı TEK çağrıda: makine id → { "YYYY-MM-DD": { hours, note } }. */
export async function getMonthMachineData(siteId: number, ownerId: string, first: string, last: string): Promise<Record<number, Record<string, DayEntry>>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_month_machine_attendance", { p_site_id: siteId, p_owner: ownerId, p_first: first, p_last: last });
  if (error) throw new Error("aylık makine puantajı okunamadı");
  const out: Record<number, Record<string, DayEntry>> = {};
  for (const r of (data ?? []) as { machine_id: number; days: Record<string, { h: number | string | null; n: string | null }> }[]) {
    out[r.machine_id] = Object.fromEntries(Object.entries(r.days).map(([d, v]) => [d, { hours: v.h === null ? null : Number(v.h), note: v.n }]));
  }
  return out;
}

export type RentalPayment = {
  id: number;
  machineId: number;
  amount: number;
  date: string;
  method: "nakit" | "havale" | "cek" | "diger" | null;
  /** Miktar × birim kira dökümü (kasadan tutarı elle değiştirilmiş kayıtta boştur) */
  qty: number | null;
  rate: number | null;
  unit: RateUnit | null;
  sourceIncomeId: number | null;
  /** Ödeme puantaja bağlı mı (ay tam ödenmiş)? Bağlıysa puantaj değişince otomatik güncellenir. */
  synced: boolean;
};

/** Bir ortağın bir aya (YYYY-MM) ait kira ödemeleri: makineye bağlı giderler. */
export async function listMonthRentalPayments(siteId: number, ownerId: string, ym: string): Promise<RentalPayment[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("transactions")
    .select("id, machine_id, amount, transaction_date, payment_method, machine_qty, machine_rate, machine_unit, source_income_id, machine_synced")
    .eq("site_id", siteId)
    .eq("user_id", ownerId)
    .eq("period_month", `${ym}-01`)
    .not("machine_id", "is", null)
    .order("transaction_date", { ascending: false })
    .order("id", { ascending: false })
    .limit(500);
  if (error) throw new Error("kira ödemeleri okunamadı");
  return ((data ?? []) as unknown as {
    id: number;
    machine_id: number;
    amount: number | string;
    transaction_date: string;
    payment_method: RentalPayment["method"];
    machine_qty: number | string | null;
    machine_rate: number | string | null;
    machine_unit: RateUnit | null;
    source_income_id: number | null;
    machine_synced: boolean;
  }[]).map((r) => ({
    id: r.id,
    machineId: r.machine_id,
    amount: Number(r.amount),
    date: r.transaction_date,
    method: r.payment_method,
    qty: r.machine_qty === null ? null : Number(r.machine_qty),
    rate: r.machine_rate === null ? null : Number(r.machine_rate),
    unit: r.machine_unit,
    sourceIncomeId: r.source_income_id,
    synced: r.machine_synced,
  }));
}
