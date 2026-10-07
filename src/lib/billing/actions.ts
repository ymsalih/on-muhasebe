"use server";

import { revalidatePath } from "next/cache";
import { requireAuthId } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { computeKdv } from "@/lib/billing/kdv";
import { invoiceSchema, num, progressPaymentSchema, type InvoiceValues, type ProgressPaymentValues } from "@/lib/billing/schemas";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const GENERIC_ERROR = "İşlem tamamlanamadı, bağlantınızı kontrol edip tekrar deneyin.";
const NO_WRITE_ERROR = "Bu kaydı değiştirme yetkiniz yok (yalnızca kendi kayıtlarınızı değiştirebilirsiniz).";

const mapError = (error: { code?: string }) => (error.code === "42501" ? NO_WRITE_ERROR : error.code === "23514" ? "Girilen bilgilerden biri geçersiz." : GENERIC_ERROR);
const refresh = (siteId: number) => revalidatePath(`/sites/${siteId}/hakedis`);

/** Hakediş ekler/günceller. `created_by` oturumdan gelir; yetki RLS'tedir (yalnızca kayıt sahibi ortak yazar). */
export async function saveProgressPayment(siteId: number, id: number | null, input: ProgressPaymentValues): Promise<Result<{ id: number }>> {
  const userId = await requireAuthId();
  if (!Number.isInteger(siteId)) return { ok: false, error: "Geçersiz şantiye." };
  const parsed = progressPaymentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Girilen bilgiler geçersiz." };
  const v = parsed.data;
  const row = { payment_date: v.date, description: v.description || null, amount: num(v.amount) };

  const supabase = await createClient();
  if (id === null) {
    const { data, error } = await supabase.from("progress_payments").insert({ ...row, site_id: siteId, created_by: userId }).select("id").single();
    if (error || !data) return { ok: false, error: error ? mapError(error) : GENERIC_ERROR };
    refresh(siteId);
    return { ok: true, id: data.id };
  }
  const { data, error } = await supabase.from("progress_payments").update(row).eq("id", id).eq("site_id", siteId).select("id");
  if (error) return { ok: false, error: mapError(error) };
  if (!data || data.length === 0) return { ok: false, error: NO_WRITE_ERROR };
  refresh(siteId);
  return { ok: true, id };
}

export async function deleteProgressPayment(siteId: number, id: number): Promise<Result> {
  await requireAuthId();
  if (!Number.isInteger(siteId) || !Number.isInteger(id)) return { ok: false, error: "Geçersiz istek." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("progress_payments").delete().eq("id", id).eq("site_id", siteId).select("id");
  if (error) return { ok: false, error: mapError(error) };
  if (!data || data.length === 0) return { ok: false, error: NO_WRITE_ERROR };
  refresh(siteId);
  return { ok: true };
}

/** Fatura ekler/günceller (tür, açıklama, tutar ve KDV). Toplam faturaya yansır; kalan fatura her açılışta yeniden hesaplanır. */
export async function saveInvoice(siteId: number, id: number | null, input: InvoiceValues): Promise<Result<{ id: number }>> {
  const userId = await requireAuthId();
  if (!Number.isInteger(siteId)) return { ok: false, error: "Geçersiz şantiye." };
  const parsed = invoiceSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Girilen bilgiler geçersiz." };
  const v = parsed.data;
  // Matrah, KDV ve oran sunucuda yeniden hesaplanır (istemciden gelen rakama güvenilmez); veritabanı tutarlılığı ayrıca denetler.
  const k = computeKdv(v.amount, v.kdvRate, v.amountMode);
  if (!k) return { ok: false, error: "Tutar veya KDV oranı geçersiz." };
  const row = { invoice_date: v.date, invoice_no: v.invoiceNo || null, invoice_type: v.type, description: v.description, amount: k.net, kdv_rate: k.rate, kdv_amount: k.kdv };

  const supabase = await createClient();
  if (id === null) {
    const { data, error } = await supabase.from("invoices").insert({ ...row, site_id: siteId, created_by: userId }).select("id").single();
    if (error || !data) return { ok: false, error: error ? mapError(error) : GENERIC_ERROR };
    refresh(siteId);
    return { ok: true, id: data.id };
  }
  const { data, error } = await supabase.from("invoices").update(row).eq("id", id).eq("site_id", siteId).select("id");
  if (error) return { ok: false, error: mapError(error) };
  if (!data || data.length === 0) return { ok: false, error: NO_WRITE_ERROR };
  refresh(siteId);
  return { ok: true, id };
}

export async function deleteInvoice(siteId: number, id: number): Promise<Result> {
  await requireAuthId();
  if (!Number.isInteger(siteId) || !Number.isInteger(id)) return { ok: false, error: "Geçersiz istek." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("invoices").delete().eq("id", id).eq("site_id", siteId).select("id");
  if (error) return { ok: false, error: mapError(error) };
  if (!data || data.length === 0) return { ok: false, error: NO_WRITE_ERROR };
  refresh(siteId);
  return { ok: true };
}
