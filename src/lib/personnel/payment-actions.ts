"use server";

import { revalidatePath } from "next/cache";
import { requireAuthId } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { formatCurrency } from "@/lib/format";
import { monthLabel, personPaymentSchema, wageTotal, type PersonPaymentValues } from "@/lib/personnel/payment-schemas";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const GENERIC_ERROR = "İşlem tamamlanamadı, bağlantınızı kontrol edip tekrar deneyin.";
const NO_WRITE_ERROR = "Bu şantiyede kayıt ekleme/düzenleme yetkiniz yok.";

function mapError(error: { code?: string; message?: string }): string {
  if (error.code === "42501") return NO_WRITE_ERROR;
  if (error.code === "23503" && /Kaynak gelir/.test(error.message ?? "")) return "Seçilen gelir bu şantiyeye ait bir gelir kaydı değil.";
  return GENERIC_ERROR;
}

function refresh(siteId: number) {
  revalidatePath(`/sites/${siteId}`, "layout");
}

/**
 * Maaş ödemesi kaydeder/günceller (Puantaj → Maaş Ödemeleri): kasada bir GİDER olarak (kategori "İşçilik", personele bağlı)
 * yazılır ve isteğe bağlı olarak hangi GELİRDEN ödendiği (kaynak gelir) belirtilir. Tutar = gün × günlük tutar,
 * sunucuda hesaplanır; istemciden alınmaz. Yetki RLS'tedir (owner/partner).
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
    source_income_id: v.sourceIncomeId ? Number(v.sourceIncomeId) : null,
  };

  if (txId === null) {
    const { data, error } = await supabase
      .from("transactions")
      .insert({ ...row, site_id: siteId, user_id: userId })
      .select("id")
      .single();
    if (error || !data) return { ok: false, error: error ? mapError(error) : GENERIC_ERROR };
    refresh(siteId);
    return { ok: true, id: data.id };
  }

  const { data, error } = await supabase
    .from("transactions")
    .update(row)
    .eq("id", txId)
    .eq("site_id", siteId)
    .eq("personnel_id", personId)
    .select("id");
  if (error) return { ok: false, error: mapError(error) };
  if (!data || data.length === 0) return { ok: false, error: NO_WRITE_ERROR };
  refresh(siteId);
  return { ok: true, id: txId };
}
