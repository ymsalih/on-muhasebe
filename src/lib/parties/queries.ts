import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { PartyCategory } from "@/lib/goods/schemas";

export type PartyBalance = {
  party_id: number;
  name: string;
  category: PartyCategory;
  total_income: number;
  total_expense: number;
  balance: number;
  total_turnover: number;
  transaction_count: number;
  last_transaction_date: string | null;
};

const BALANCE_COLUMNS =
  "party_id, name, category, total_income, total_expense, balance, total_turnover, transaction_count, last_transaction_date";

/** Şantiyenin tüm carileri ve bakiyeleri (party_balances view'i: hesaplanan alanlar tabloda tutulmaz). */
export async function listPartyBalances(siteId: number): Promise<PartyBalance[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("party_balances").select(BALANCE_COLUMNS).eq("site_id", siteId).order("name");
  if (error) throw new Error("party_balances okunamadı");
  return ((data ?? []) as PartyBalance[]).map(normalize);
}

export async function getPartyBalance(siteId: number, partyId: number): Promise<PartyBalance | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("party_balances").select(BALANCE_COLUMNS).eq("site_id", siteId).eq("party_id", partyId).maybeSingle();
  return data ? normalize(data as PartyBalance) : null;
}

// numeric sütunlar bazı istemcilerde metin gelebilir; sayıya çevir.
function normalize(r: PartyBalance): PartyBalance {
  return {
    ...r,
    total_income: Number(r.total_income),
    total_expense: Number(r.total_expense),
    balance: Number(r.balance),
    total_turnover: Number(r.total_turnover),
  };
}

export type PartyDetail = {
  id: number;
  name: string;
  category: PartyCategory;
  phone: string | null;
  address: string | null;
  notes: string | null;
};

export async function getParty(siteId: number, partyId: number): Promise<PartyDetail | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("parties")
    .select("id, name, category, phone, address, notes")
    .eq("site_id", siteId)
    .eq("id", partyId)
    .maybeSingle();
  return (data as PartyDetail | null) ?? null;
}

export type PartyTransaction = {
  id: number;
  type: "income" | "expense";
  description: string;
  amount: number;
  payment_method: "nakit" | "havale" | "cek" | "diger" | null;
  transaction_date: string;
  category_id: number | null;
  categories: { name: string } | null;
  users: { full_name: string } | null;
};

export const TRANSACTION_LIST_LIMIT = 300;

/** Bir carinin hareketleri, en yeniden eskiye (tarih, açıklama, tutar, yöntem, giren kişi). */
export async function listPartyTransactions(siteId: number, partyId: number): Promise<PartyTransaction[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("transactions")
    .select("id, type, description, amount, payment_method, transaction_date, category_id, categories(name), users(full_name)")
    .eq("site_id", siteId)
    .eq("party_id", partyId)
    .order("transaction_date", { ascending: false })
    .order("id", { ascending: false })
    .limit(TRANSACTION_LIST_LIMIT);
  if (error) throw new Error("transactions okunamadı");
  return ((data ?? []) as unknown as PartyTransaction[]).map((t) => ({ ...t, amount: Number(t.amount) }));
}
