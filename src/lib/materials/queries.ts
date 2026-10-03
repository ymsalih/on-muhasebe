import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Breakdown } from "@/lib/materials/schemas";

export type EntryRow = {
  id: number;
  date: string;
  name: string;
  variant: string | null;
  unit: string;
  quantity: number;
  unitPrice: number;
  total: number;
  supplier: string | null;
  usedFor: string | null;
  note: string | null;
  enteredBy: string | null;
};

export const ENTRY_LIST_LIMIT = 300;

/** Dönemdeki malzeme girişleri, en yeniden eskiye. `limit + 1` çekilir; fazlası "daha var" bilgisidir. */
export async function listMaterialEntries(siteId: number, from: string, to: string, limit = ENTRY_LIST_LIMIT): Promise<{ rows: EntryRow[]; hasMore: boolean }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("material_entries")
    .select("id, entry_date, name, variant, unit, quantity, unit_price, total_amount, supplier, used_for, note, users(full_name)")
    .eq("site_id", siteId)
    .gte("entry_date", from)
    .lte("entry_date", to)
    .order("entry_date", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit + 1);
  if (error) throw new Error("material_entries okunamadı");

  const all = ((data ?? []) as unknown as {
    id: number;
    entry_date: string;
    name: string;
    variant: string | null;
    unit: string;
    quantity: number | string;
    unit_price: number | string;
    total_amount: number | string;
    supplier: string | null;
    used_for: string | null;
    note: string | null;
    users: { full_name: string } | null;
  }[]).map((r) => ({
    id: r.id,
    date: r.entry_date,
    name: r.name,
    variant: r.variant,
    unit: r.unit,
    quantity: Number(r.quantity),
    unitPrice: Number(r.unit_price),
    total: Number(r.total_amount),
    supplier: r.supplier,
    usedFor: r.used_for,
    note: r.note,
    enteredBy: r.users?.full_name ?? null,
  }));
  return { rows: all.slice(0, limit), hasMore: all.length > limit };
}

export type BreakdownRow = { key: string; label: string; unit: string | null; count: number; quantity: number | null; total: number };

/** Maliyet kırılımı (kimin girdiği / malzeme / kullanım yeri) — get_material_cost_breakdown RPC'siyle TEK çağrıda. */
export async function getCostBreakdown(siteId: number, from: string, to: string, by: Breakdown): Promise<BreakdownRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_material_cost_breakdown", { p_site_id: siteId, p_from: from, p_to: to, p_by: by });
  if (error) throw new Error("get_material_cost_breakdown okunamadı");
  return ((data ?? []) as { group_key: string; label: string; unit: string | null; entry_count: number; total_quantity: number | string | null; total: number | string }[]).map((r) => ({
    key: r.group_key,
    label: r.label,
    unit: r.unit,
    count: r.entry_count,
    quantity: r.total_quantity === null ? null : Number(r.total_quantity),
    total: Number(r.total),
  }));
}

export type Suggestions = { names: string[]; variants: string[]; units: string[]; suppliers: string[]; usages: string[] };

/** Formdaki otomatik tamamlama önerileri: bu şantiyede daha önce girilmiş değerler. */
export async function getSuggestions(siteId: number): Promise<Suggestions> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("material_entries")
    .select("name, variant, unit, supplier, used_for")
    .eq("site_id", siteId)
    .order("id", { ascending: false })
    .limit(300);
  const uniq = (key: "name" | "variant" | "unit" | "supplier" | "used_for") => [...new Set((data ?? []).map((r) => r[key]).filter((v): v is string => !!v))].slice(0, 50);
  return { names: uniq("name"), variants: uniq("variant"), units: uniq("unit"), suppliers: uniq("supplier"), usages: uniq("used_for") };
}
