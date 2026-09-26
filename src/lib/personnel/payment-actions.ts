"use server";

import { revalidatePath } from "next/cache";
import { requireAuthId } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { formatCurrency } from "@/lib/format";
import { monthLabel, personPaymentSchema, wageTotal, type PersonPaymentValues } from "@/lib/personnel/payment-schemas";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const GENERIC_ERROR = "İşlem tamamlanamadı, bağlantınızı kontrol edip tekrar deneyin.";
const NO_WRITE_ERROR = "Bu şantiyede kayıt ekleme/düzenleme yetkiniz yok.";

function monthBoundsOf(month: string): { first: string; last: string } {
  const [y, m] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { first: `${month}-01`, last: `${month}-${String(lastDay).padStart(2, "0")}` };
}

/** Puantajdaki o ayın gün sayısı: ödeme penceresinde varsayılan gün olarak önerilir. */
export async function getMonthWorkDays(siteId: number, personId: number, month: string): Promise<Result<{ days: number }>> {
  await requireAuthId();
  if (!Number.isInteger(siteId) || !Number.isInteger(personId) || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    return { ok: false, error: "Geçersiz istek." };
  }
  const { first, last } = monthBoundsOf(month);
  const supabase = await createClient();
  const { count, error } = await supabase
    .from("attendance")
    .select("id", { count: "exact", head: true })
    .eq("site_id", siteId)
    .eq("personnel_id", personId)
    .gte("work_date", first)
    .lte("work_date", last);
  if (error) return { ok: false, error: GENERIC_ERROR };
  return { ok: true, days: count ?? 0 };
}

/**
 * Maaş ödemesi kaydeder/günceller: kasada bir GİDER olarak (kategori "İşçilik", personele bağlı) yazılır.
 * Tutar = gün × günlük tutar, sunucuda hesaplanır. Yetki RLS'tedir (owner/partner).
 */
export async function savePersonPayment(
  siteId: number,
  personId: number,
  txId: number | null,
  input: PersonPaymentValues,
): Promise<Result<{ id: number }>> {
  const userId = await requireAuthId();
  if (!Number.isInteger(siteId) || !Number.isInteger(personId)) return { ok: false, error: "Geçersiz istek." };

  const parsed = personPaymentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Girilen bilgiler geçersiz." };
  const v = parsed.data;
  const days = Number(v.workDays);
  const rate = Number(v.dailyRate.replace(",", "."));

  const supabase = await createClient();
  const [{ data: person }, { data: cats }] = await Promise.all([
    supabase.from("personnel").select("id, full_name").eq("site_id", siteId).eq("id", personId).maybeSingle(),
    supabase.from("categories").select("id, site_id").eq("type", "expense").eq("name", "İşçilik").or(`site_id.is.null,site_id.eq.${siteId}`),
  ]);
  if (!person) return { ok: false, error: "Personel bulunamadı." };
  const category = (cats ?? []).find((c) => c.site_id === siteId) ?? (cats ?? [])[0];

  const row = {
    type: "expense" as const,
    amount: wageTotal(days, rate),
    transaction_date: v.date,
    description: `${monthLabel(v.month)} maaşı — ${person.full_name} (${days} gün × ${formatCurrency(rate)})`,
    payment_method: v.paymentMethod || null,
    category_id: category?.id ?? null,
    personnel_id: personId,
    work_days: days,
    daily_rate: rate,
    period_month: `${v.month}-01`,
  };

  if (txId === null) {
    const { data, error } = await supabase
      .from("transactions")
      .insert({ ...row, site_id: siteId, user_id: userId })
      .select("id")
      .single();
    if (error || !data) return { ok: false, error: error?.code === "42501" ? NO_WRITE_ERROR : GENERIC_ERROR };
    revalidatePath(`/sites/${siteId}`, "layout");
    return { ok: true, id: data.id };
  }

  const { data, error } = await supabase
    .from("transactions")
    .update(row)
    .eq("id", txId)
    .eq("site_id", siteId)
    .eq("personnel_id", personId)
    .select("id");
  if (error) return { ok: false, error: error.code === "42501" ? NO_WRITE_ERROR : GENERIC_ERROR };
  if (!data || data.length === 0) return { ok: false, error: NO_WRITE_ERROR };
  revalidatePath(`/sites/${siteId}`, "layout");
  return { ok: true, id: txId };
}
