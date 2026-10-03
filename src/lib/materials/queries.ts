import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { MovementType } from "@/lib/materials/schemas";

export type MaterialSummaryRow = {
  id: number;
  name: string;
  variant: string | null;
  unit: string;
  avgCost: number;
  stockQty: number;
  stockValue: number;
  periodInQty: number;
  periodInAmount: number;
  periodOutQty: number;
  periodOutAmount: number;
};

export type MaterialTotals = { inAmount: number; outAmount: number; stockValue: number };

/** Şantiyenin tüm malzemeleri, stok ve dönem özetiyle — get_material_summary RPC'siyle TEK çağrıda. */
export async function getMaterialSummary(siteId: number, from: string, to: string): Promise<{ rows: MaterialSummaryRow[]; totals: MaterialTotals }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_material_summary", { p_site_id: siteId, p_from: from, p_to: to });
  if (error) throw new Error("get_material_summary okunamadı");
  const rows = ((data ?? []) as Record<string, string | number | null>[]).map((r) => ({
    id: Number(r.material_id),
    name: String(r.name),
    variant: (r.variant as string | null) ?? null,
    unit: String(r.unit),
    avgCost: Number(r.avg_cost),
    stockQty: Number(r.stock_qty),
    stockValue: Number(r.stock_value),
    periodInQty: Number(r.period_in_qty),
    periodInAmount: Number(r.period_in_amount),
    periodOutQty: Number(r.period_out_qty),
    periodOutAmount: Number(r.period_out_amount),
  }));
  return {
    rows,
    totals: {
      inAmount: rows.reduce((s, r) => s + r.periodInAmount, 0),
      outAmount: rows.reduce((s, r) => s + r.periodOutAmount, 0),
      stockValue: rows.reduce((s, r) => s + r.stockValue, 0),
    },
  };
}

export type MovementRow = {
  id: number;
  materialId: number;
  type: MovementType;
  date: string;
  quantity: number;
  unitPrice: number | null;
  counterparty: string | null;
  note: string | null;
  material: { name: string; variant: string | null; unit: string } | null;
};

export const MOVEMENT_LIST_LIMIT = 300;

/** Dönemdeki hareketler, en yeniden eskiye. `limit + 1` çekilir; fazlası "daha var" bilgisidir. */
export async function listMovements(
  siteId: number,
  filters: { from: string; to: string; type?: MovementType },
  limit = MOVEMENT_LIST_LIMIT,
): Promise<{ rows: MovementRow[]; hasMore: boolean }> {
  const supabase = await createClient();
  let query = supabase
    .from("material_movements")
    .select("id, material_id, movement_type, movement_date, quantity, unit_price, counterparty, note, materials(name, variant, unit)")
    .eq("site_id", siteId)
    .gte("movement_date", filters.from)
    .lte("movement_date", filters.to);
  if (filters.type) query = query.eq("movement_type", filters.type);
  const { data, error } = await query.order("movement_date", { ascending: false }).order("id", { ascending: false }).limit(limit + 1);
  if (error) throw new Error("material_movements okunamadı");

  const all = ((data ?? []) as unknown as {
    id: number;
    material_id: number;
    movement_type: MovementType;
    movement_date: string;
    quantity: number | string;
    unit_price: number | string | null;
    counterparty: string | null;
    note: string | null;
    materials: { name: string; variant: string | null; unit: string } | null;
  }[]).map((r) => ({
    id: r.id,
    materialId: r.material_id,
    type: r.movement_type,
    date: r.movement_date,
    quantity: Number(r.quantity),
    unitPrice: r.unit_price === null ? null : Number(r.unit_price),
    counterparty: r.counterparty,
    note: r.note,
    material: r.materials,
  }));
  return { rows: all.slice(0, limit), hasMore: all.length > limit };
}
