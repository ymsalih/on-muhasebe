import "server-only";
import { createClient } from "@/lib/supabase/server";

export type PersonPayment = {
  id: number;
  amount: number;
  transaction_date: string;
  payment_method: "nakit" | "havale" | "cek" | "diger" | null;
  work_days: number | null;
  daily_rate: number | null;
  period_month: string | null;
  description: string;
};

/** Bir personele yapılan ödemeler (kasadaki gider kayıtları), en yeniden eskiye. */
export async function listPersonPayments(siteId: number, personId: number): Promise<PersonPayment[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("transactions")
    .select("id, amount, transaction_date, payment_method, work_days, daily_rate, period_month, description")
    .eq("site_id", siteId)
    .eq("personnel_id", personId)
    .order("transaction_date", { ascending: false })
    .order("id", { ascending: false })
    .limit(200);
  if (error) throw new Error("personel ödemeleri okunamadı");
  return ((data ?? []) as PersonPayment[]).map((r) => ({
    ...r,
    amount: Number(r.amount),
    daily_rate: r.daily_rate === null ? null : Number(r.daily_rate),
  }));
}

export type MonthWagePayment = {
  id: number;
  personnelId: number;
  personName: string;
  amount: number;
  date: string;
  method: "nakit" | "havale" | "cek" | "diger" | null;
  /** Gün × ücret dökümü (kasadan tutarı elle değiştirilmiş kayıtta boştur) */
  workDays: number | null;
  dailyRate: number | null;
  sourceIncomeId: number | null;
};

/** Bir ayın (YYYY-MM) maaş ödemeleri: o ayın hakedişi için yapılan, personele bağlı giderler. */
export async function listMonthWagePayments(siteId: number, ym: string): Promise<MonthWagePayment[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("transactions")
    .select("id, personnel_id, amount, transaction_date, payment_method, work_days, daily_rate, source_income_id, personnel(full_name)")
    .eq("site_id", siteId)
    .eq("period_month", `${ym}-01`)
    .not("personnel_id", "is", null)
    .order("transaction_date", { ascending: false })
    .order("id", { ascending: false })
    .limit(500);
  if (error) throw new Error("maaş ödemeleri okunamadı");
  return ((data ?? []) as unknown as {
    id: number;
    personnel_id: number;
    amount: number | string;
    transaction_date: string;
    payment_method: MonthWagePayment["method"];
    work_days: number | null;
    daily_rate: number | string | null;
    source_income_id: number | null;
    personnel: { full_name: string } | null;
  }[]).map((r) => ({
    id: r.id,
    personnelId: r.personnel_id,
    personName: r.personnel?.full_name ?? "Silinmiş personel",
    amount: Number(r.amount),
    date: r.transaction_date,
    method: r.payment_method,
    workDays: r.work_days,
    dailyRate: r.daily_rate === null ? null : Number(r.daily_rate),
    sourceIncomeId: r.source_income_id,
  }));
}
