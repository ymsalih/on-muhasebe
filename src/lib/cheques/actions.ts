"use server";

import { revalidatePath } from "next/cache";
import { requireAuthId } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { chequeSchema, num, type ChequeValues } from "@/lib/cheques/schemas";
import { todayInIstanbul } from "@/lib/personnel/status";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const GENERIC_ERROR = "İşlem tamamlanamadı, bağlantınızı kontrol edip tekrar deneyin.";
const NO_WRITE_ERROR = "Bu şantiyede kayıt ekleme/düzenleme yetkiniz yok (arşivdeki şantiyede veya kendinize ait olmayan çekte değişiklik yapılamaz).";

function mapError(error: { code?: string }): string {
  switch (error.code) {
    case "42501":
      return NO_WRITE_ERROR;
    case "23514":
      return "Girilen bilgilerden biri geçersiz (tutar sıfırdan büyük, düzenleme tarihi vadeden önce olmalı).";
    default:
      return GENERIC_ERROR;
  }
}

/** Çek değişince çek sayfası, ana sayfa uyarıları (şantiye düzeni) ve şantiye seçim ekranı tazelenir. */
const refresh = (siteId: number) => {
  revalidatePath(`/sites/${siteId}/cekler`);
  revalidatePath(`/sites/${siteId}`, "layout");
  revalidatePath("/sites");
};

/** Çek ekler/günceller. `owner_id` oturumdan gelir; yetki ve "kendi çekim" kuralı veritabanındadır (RLS). */
export async function saveCheque(siteId: number, chequeId: number | null, input: ChequeValues): Promise<Result<{ id: number }>> {
  const userId = await requireAuthId();
  if (!Number.isInteger(siteId)) return { ok: false, error: "Geçersiz şantiye." };
  const parsed = chequeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Girilen bilgiler geçersiz." };
  const v = parsed.data;
  const row = {
    direction: v.direction,
    counterparty: v.counterparty,
    amount: num(v.amount),
    due_date: v.dueDate,
    issue_date: v.issueDate || null,
    cheque_no: v.chequeNo || null,
    bank: v.bank || null,
    note: v.note || null,
    status: v.status,
    // tahsil/ödeme tarihi yalnızca "tahsil edildi/ödendi" durumunda; girilmediyse bugün
    settled_date: v.status === "settled" ? v.settledDate || todayInIstanbul() : null,
  };

  const supabase = await createClient();
  if (chequeId === null) {
    const { data, error } = await supabase.from("cheques").insert({ ...row, site_id: siteId, owner_id: userId }).select("id").single();
    if (error || !data) return { ok: false, error: error ? mapError(error) : GENERIC_ERROR };
    refresh(siteId);
    return { ok: true, id: data.id };
  }
  const { data, error } = await supabase.from("cheques").update(row).eq("id", chequeId).eq("site_id", siteId).select("id");
  if (error) return { ok: false, error: mapError(error) };
  if (!data || data.length === 0) return { ok: false, error: NO_WRITE_ERROR };
  refresh(siteId);
  return { ok: true, id: chequeId };
}

export async function deleteCheque(siteId: number, chequeId: number): Promise<Result> {
  await requireAuthId();
  if (!Number.isInteger(siteId) || !Number.isInteger(chequeId)) return { ok: false, error: "Geçersiz istek." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("cheques").delete().eq("id", chequeId).eq("site_id", siteId).select("id");
  if (error) return { ok: false, error: mapError(error) };
  if (!data || data.length === 0) return { ok: false, error: NO_WRITE_ERROR };
  refresh(siteId);
  return { ok: true };
}
