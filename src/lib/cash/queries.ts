import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { CashType } from "@/lib/cash/schemas";
import type { IncomeAllocation } from "@/lib/cash/sources";

export type Category = { id: number; site_id: number | null; name: string; type: CashType };

/** Şantiyenin görebildiği kategoriler: varsayılanlar (site_id boş) + şantiyeye özel olanlar. */
export async function listCategories(siteId: number): Promise<Category[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("categories")
    .select("id, site_id, name, type")
    .or(`site_id.is.null,site_id.eq.${siteId}`)
    .order("name");
  if (error) throw new Error("categories okunamadı");
  return (data as Category[]) ?? [];
}

export type CashRow = {
  id: number;
  type: CashType;
  description: string;
  amount: number;
  payment_method: "nakit" | "havale" | "cek" | "diger" | null;
  transaction_date: string;
  category_id: number | null;
  party_id: number | null;
  source_income_id: number | null;
  categories: { name: string } | null;
  parties: { name: string } | null;
  users: { full_name: string } | null;
};

const CASH_COLUMNS =
  "id, type, description, amount, payment_method, transaction_date, category_id, party_id, source_income_id, categories(name), parties(name), users(full_name)";

/** source: belirli bir gelirin giderleri (id), kaynağı belirtilmiş ("any") ya da belirtilmemiş ("none") giderler. */
export type CashFilters = { from?: string; to?: string; type?: CashType; categoryId?: number; source?: number | "any" | "none" };

/** Kasa hareketleri, en yeniden eskiye. `limit + 1` çekilir; fazlası "daha fazla var" bilgisidir. */
export async function listCashTransactions(siteId: number, filters: CashFilters, limit: number): Promise<{ rows: CashRow[]; hasMore: boolean }> {
  const supabase = await createClient();
  let query = supabase.from("transactions").select(CASH_COLUMNS).eq("site_id", siteId);
  if (filters.from) query = query.gte("transaction_date", filters.from);
  if (filters.to) query = query.lte("transaction_date", filters.to);
  if (filters.type) query = query.eq("type", filters.type);
  if (filters.categoryId) query = query.eq("category_id", filters.categoryId);
  if (typeof filters.source === "number") query = query.eq("type", "expense").eq("source_income_id", filters.source);
  else if (filters.source === "any") query = query.eq("type", "expense").not("source_income_id", "is", null);
  else if (filters.source === "none") query = query.eq("type", "expense").is("source_income_id", null);

  const { data, error } = await query
    .order("transaction_date", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit + 1);
  if (error) throw new Error("transactions okunamadı");

  const all = ((data ?? []) as unknown as CashRow[]).map((r) => ({ ...r, amount: Number(r.amount) }));
  return { rows: all.slice(0, limit), hasMore: all.length > limit };
}

export type CashSummary = {
  income: number;
  expense: number;
  /** tür + kategori kırılımı; category_id boş = kategorisiz */
  byCategory: { type: CashType; category_id: number | null; total: number; count: number }[];
};

/** Seçilen aralığın gelir/gider toplamları — get_cash_summary RPC'siyle TEK çağrıda. */
export async function getCashSummary(siteId: number, from: string, to: string): Promise<CashSummary> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_cash_summary", { p_site_id: siteId, p_from: from, p_to: to });
  if (error) throw new Error("get_cash_summary okunamadı");

  const byCategory = ((data ?? []) as { type: CashType; category_id: number | null; total: number | string; tx_count: number }[]).map((r) => ({
    type: r.type,
    category_id: r.category_id,
    total: Number(r.total),
    count: r.tx_count,
  }));
  const sum = (t: CashType) => byCategory.filter((r) => r.type === t).reduce((s, r) => s + r.total, 0);
  return { income: sum("income"), expense: sum("expense"), byCategory };
}

/**
 * Gelir kayıtları ve her birinden harcanan tutar — get_income_allocations RPC'siyle TEK çağrıda.
 * from/to boşsa tüm zamanlar (en yeni `limit` gelir; en çok 1000).
 */
export async function getIncomeAllocations(siteId: number, from: string | null, to: string | null, limit = 1000): Promise<IncomeAllocation[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_income_allocations", { p_site_id: siteId, p_from: from, p_to: to, p_limit: limit });
  if (error) throw new Error("get_income_allocations okunamadı");
  return ((data ?? []) as { income_id: number; transaction_date: string; description: string; category_id: number | null; amount: number | string; spent: number | string; expense_count: number }[]).map((r) => ({
    id: r.income_id,
    date: r.transaction_date,
    description: r.description,
    categoryId: r.category_id,
    amount: Number(r.amount),
    spent: Number(r.spent),
    expenseCount: r.expense_count,
  }));
}

export type ExpenseSourceSplit = { linked: number; linkedCount: number; unlinked: number; unlinkedCount: number };

/** Aralıktaki giderlerin kaynağı belirtilmiş / belirtilmemiş toplamı. */
export async function getExpenseSourceSplit(siteId: number, from: string, to: string): Promise<ExpenseSourceSplit> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_expense_source_split", { p_site_id: siteId, p_from: from, p_to: to });
  if (error) throw new Error("get_expense_source_split okunamadı");
  const r = ((data ?? []) as { linked: number | string; linked_count: number; unlinked: number | string; unlinked_count: number }[])[0];
  return { linked: Number(r?.linked ?? 0), linkedCount: r?.linked_count ?? 0, unlinked: Number(r?.unlinked ?? 0), unlinkedCount: r?.unlinked_count ?? 0 };
}
