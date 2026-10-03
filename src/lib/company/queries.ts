import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { CompanyEntryType } from "@/lib/company/schemas";

export type CompanyEntryRow = {
  id: number;
  entry_type: CompanyEntryType;
  entry_date: string;
  description: string;
  amount: number;
};

export const COMPANY_LIST_LIMIT = 500;

/** Bir ortağın şirket kasası kayıtları, dönem içinde, en yeniden eskiye. RLS: yalnızca sahibi ve admin okur. */
export async function listCompanyEntries(ownerId: string, from: string, to: string): Promise<{ rows: CompanyEntryRow[]; hasMore: boolean }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("company_entries")
    .select("id, entry_type, entry_date, description, amount")
    .eq("owner_id", ownerId)
    .gte("entry_date", from)
    .lte("entry_date", to)
    .order("entry_date", { ascending: false })
    .order("id", { ascending: false })
    .limit(COMPANY_LIST_LIMIT + 1);
  if (error) throw new Error("company_entries okunamadı");
  const all = ((data ?? []) as unknown as CompanyEntryRow[]).map((r) => ({ ...r, amount: Number(r.amount) }));
  return { rows: all.slice(0, COMPANY_LIST_LIMIT), hasMore: all.length > COMPANY_LIST_LIMIT };
}

export type CompanySummary = { income: number; expense: number; result: number; count: number };

/** Dönem kâr/zarar: get_company_summary RPC'si ile TEK çağrıda. Kâr/zarar = gelir − gider. */
export async function getCompanySummary(ownerId: string, from: string, to: string): Promise<CompanySummary> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_company_summary", { p_owner: ownerId, p_from: from, p_to: to });
  if (error) throw new Error("get_company_summary okunamadı");
  const row = ((data ?? []) as { income: number | string; expense: number | string; entry_count: number }[])[0];
  const income = Number(row?.income ?? 0);
  const expense = Number(row?.expense ?? 0);
  return { income, expense, result: income - expense, count: row?.entry_count ?? 0 };
}
