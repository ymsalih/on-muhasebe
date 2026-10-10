"use server";

import { revalidatePath } from "next/cache";
import { requireAuthId } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { debtSchema, partySchema, type DebtValues, type PartyValues } from "@/lib/parties/schemas";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const GENERIC_ERROR = "İşlem tamamlanamadı, bağlantınızı kontrol edip tekrar deneyin.";
const NO_WRITE_ERROR = "Bu şantiyede kayıt ekleme/düzenleme yetkiniz yok.";

function mapError(error: { code?: string }): string {
  switch (error.code) {
    case "42501":
      return NO_WRITE_ERROR;
    case "23505":
      return "Bu adla bir cari zaten var.";
    case "23503":
      return "Bu cariye bağlı irsaliye, personel, hareket veya borç kayıtları var; silinemez.";
    case "23514":
      return "Girilen bilgilerden biri geçersiz.";
    default:
      return GENERIC_ERROR;
  }
}

const refresh = (siteId: number) => revalidatePath(`/sites/${siteId}/cari`, "layout");

/** Cari (firma/nakliyeci/araç/müşteri) oluşturur veya günceller. Yetki RLS'tedir (owner/partner). */
export async function saveParty(siteId: number, partyId: number | null, input: PartyValues): Promise<Result<{ id: number }>> {
  await requireAuthId();
  if (!Number.isInteger(siteId)) return { ok: false, error: "Geçersiz şantiye." };

  const parsed = partySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Girilen bilgiler geçersiz." };
  const v = parsed.data;
  const row = { name: v.name, category: v.category, phone: v.phone || null, address: v.address || null, notes: v.notes || null };

  const supabase = await createClient();
  if (partyId === null) {
    const { data, error } = await supabase.from("parties").insert({ ...row, site_id: siteId }).select("id").single();
    if (error || !data) return { ok: false, error: error ? mapError(error) : GENERIC_ERROR };
    refresh(siteId);
    return { ok: true, id: data.id };
  }

  const { data, error } = await supabase.from("parties").update(row).eq("id", partyId).eq("site_id", siteId).select("id");
  if (error) return { ok: false, error: mapError(error) };
  if (!data || data.length === 0) return { ok: false, error: NO_WRITE_ERROR };
  refresh(siteId);
  return { ok: true, id: partyId };
}

/** Yalnızca hiçbir kaydı (irsaliye, personel, hareket) olmayan cari silinir; aksi halde yabancı anahtar engeller. */
export async function deleteParty(siteId: number, partyId: number): Promise<Result> {
  await requireAuthId();
  if (!Number.isInteger(siteId) || !Number.isInteger(partyId)) return { ok: false, error: "Geçersiz istek." };

  const supabase = await createClient();
  const { data, error } = await supabase.from("parties").delete().eq("id", partyId).eq("site_id", siteId).select("id");
  if (error) return { ok: false, error: mapError(error) };
  if (!data || data.length === 0) return { ok: false, error: NO_WRITE_ERROR };
  refresh(siteId);
  return { ok: true };
}

const refreshDebts = (siteId: number) => {
  revalidatePath(`/sites/${siteId}/cari`, "layout");
  revalidatePath(`/sites/${siteId}/raporlar`);
};

/**
 * Cariye borç yazar/günceller ("çelikçiye 100.000 ₺ borcum var"). `created_by` oturumdan gelir; yetki RLS'tedir (owner/partner).
 * Kalan borç = yazılan borç + irsaliye tutarları − ödemeler; ödeme yapıldıkça kendiliğinden düşer.
 */
export async function saveDebt(siteId: number, partyId: number, debtId: number | null, input: DebtValues): Promise<Result<{ id: number }>> {
  const userId = await requireAuthId();
  if (!Number.isInteger(siteId) || !Number.isInteger(partyId)) return { ok: false, error: "Geçersiz istek." };
  const parsed = debtSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Girilen bilgiler geçersiz." };
  const v = parsed.data;
  const row = { debt_date: v.date, amount: Number(v.amount.replace(",", ".")), description: v.description || null };

  const supabase = await createClient();
  if (debtId === null) {
    const { data, error } = await supabase.from("party_debts").insert({ ...row, site_id: siteId, party_id: partyId, created_by: userId }).select("id").single();
    if (error || !data) return { ok: false, error: error ? (error.code === "23503" ? "Cari bulunamadı." : mapError(error)) : GENERIC_ERROR };
    refreshDebts(siteId);
    return { ok: true, id: data.id };
  }
  const { data, error } = await supabase.from("party_debts").update(row).eq("id", debtId).eq("site_id", siteId).eq("party_id", partyId).select("id");
  if (error) return { ok: false, error: mapError(error) };
  if (!data || data.length === 0) return { ok: false, error: NO_WRITE_ERROR };
  refreshDebts(siteId);
  return { ok: true, id: debtId };
}

export async function deleteDebt(siteId: number, partyId: number, debtId: number): Promise<Result> {
  await requireAuthId();
  if (!Number.isInteger(siteId) || !Number.isInteger(partyId) || !Number.isInteger(debtId)) return { ok: false, error: "Geçersiz istek." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("party_debts").delete().eq("id", debtId).eq("site_id", siteId).eq("party_id", partyId).select("id");
  if (error) return { ok: false, error: mapError(error) };
  if (!data || data.length === 0) return { ok: false, error: NO_WRITE_ERROR };
  refreshDebts(siteId);
  return { ok: true };
}
