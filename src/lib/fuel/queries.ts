import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { FuelType } from "@/lib/fuel/schemas";

export type FuelRow = {
  id: number;
  machineId: number;
  machineName: string;
  machineIdentifier: string | null;
  date: string;
  fuelType: FuelType;
  liters: number;
  unitPrice: number;
  total: number;
  fueledBy: string | null;
  station: string | null;
  note: string | null;
};

export const FUEL_LIST_LIMIT = 300;

/** Bir ortağın dönemdeki yakıt kayıtları, en yeniden eskiye. `limit + 1` çekilir; fazlası "daha var" bilgisidir. */
export async function listFuelEntries(
  siteId: number,
  ownerId: string,
  from: string,
  to: string,
  machineId: number | null,
  limit = FUEL_LIST_LIMIT,
): Promise<{ rows: FuelRow[]; hasMore: boolean }> {
  const supabase = await createClient();
  let q = supabase
    .from("fuel_entries")
    .select("id, machine_id, fuel_date, fuel_type, liters, unit_price, total_amount, fueled_by, station, note, machines(name, identifier)")
    .eq("site_id", siteId)
    .eq("owner_id", ownerId)
    .gte("fuel_date", from)
    .lte("fuel_date", to);
  if (machineId !== null) q = q.eq("machine_id", machineId);
  const { data, error } = await q.order("fuel_date", { ascending: false }).order("id", { ascending: false }).limit(limit + 1);
  if (error) throw new Error("fuel_entries okunamadı");

  const all = ((data ?? []) as unknown as {
    id: number;
    machine_id: number;
    fuel_date: string;
    fuel_type: FuelType;
    liters: number | string;
    unit_price: number | string;
    total_amount: number | string;
    fueled_by: string | null;
    station: string | null;
    note: string | null;
    machines: { name: string; identifier: string | null } | null;
  }[]).map((r) => ({
    id: r.id,
    machineId: r.machine_id,
    machineName: r.machines?.name ?? "Araç",
    machineIdentifier: r.machines?.identifier ?? null,
    date: r.fuel_date,
    fuelType: r.fuel_type,
    liters: Number(r.liters),
    unitPrice: Number(r.unit_price),
    total: Number(r.total_amount),
    fueledBy: r.fueled_by,
    station: r.station,
    note: r.note,
  }));
  return { rows: all.slice(0, limit), hasMore: all.length > limit };
}

export type FuelSummaryRow = { machineId: number; name: string; count: number; liters: number; total: number };

/** Araç bazında dönem özeti (tek çağrı). Genel toplam bu satırların toplamıdır ve liste sınırından etkilenmez. */
export async function getFuelSummary(siteId: number, ownerId: string, from: string, to: string, machineId: number | null): Promise<FuelSummaryRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_fuel_summary", { p_site_id: siteId, p_owner: ownerId, p_from: from, p_to: to, p_machine: machineId });
  if (error) throw new Error("get_fuel_summary okunamadı");
  return ((data ?? []) as { machine_id: number; name: string; entry_count: number; liters: number | string; total: number | string }[]).map((r) => ({
    machineId: r.machine_id,
    name: r.name,
    count: r.entry_count,
    liters: Number(r.liters),
    total: Number(r.total),
  }));
}

/** "Kim aldı" ve "istasyon" için formdaki otomatik tamamlama önerileri (bu ortağın bu şantiyedeki geçmiş girişleri). */
export async function getFuelSuggestions(siteId: number, ownerId: string): Promise<{ people: string[]; stations: string[] }> {
  const supabase = await createClient();
  const { data } = await supabase.from("fuel_entries").select("fueled_by, station").eq("site_id", siteId).eq("owner_id", ownerId).order("id", { ascending: false }).limit(300);
  const uniq = (key: "fueled_by" | "station") => [...new Set((data ?? []).map((r) => r[key]).filter((v): v is string => !!v))].slice(0, 50);
  return { people: uniq("fueled_by"), stations: uniq("station") };
}
