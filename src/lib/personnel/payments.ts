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
