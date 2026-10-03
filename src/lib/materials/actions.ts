"use server";

import { revalidatePath } from "next/cache";
import { requireAuthId } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { materialEntrySchema, num, type MaterialEntryValues } from "@/lib/materials/schemas";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const GENERIC_ERROR = "İşlem tamamlanamadı, bağlantınızı kontrol edip tekrar deneyin.";
const NO_WRITE_ERROR = "Bu şantiyede kayıt ekleme/düzenleme yetkiniz yok.";

function mapError(error: { code?: string }): string {
  if (error.code === "42501") return NO_WRITE_ERROR;
  if (error.code === "23514") return "Girilen bilgilerden biri geçersiz (miktar ve birim fiyat sıfırdan büyük/eşit olmalı).";
  return GENERIC_ERROR;
}

/**
 * Malzeme girişi ekler veya günceller. Maliyet = miktar × birim fiyat (veritabanı hesaplar, istemciden alınmaz).
 * `created_by` oturumdan gelir. Yetki RLS'tedir (owner/partner yazar; viewer ve admin yazamaz).
 * Kullanım yeri ilk girişte boş bırakılıp sonradan düzenlemeyle eklenebilir.
 */
export async function saveMaterialEntry(siteId: number, entryId: number | null, input: MaterialEntryValues): Promise<Result<{ id: number }>> {
  const userId = await requireAuthId();
  if (!Number.isInteger(siteId)) return { ok: false, error: "Geçersiz şantiye." };
  const parsed = materialEntrySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Girilen bilgiler geçersiz." };
  const v = parsed.data;
  const row = {
    entry_date: v.date,
    name: v.name,
    variant: v.variant || null,
    unit: v.unit,
    quantity: num(v.quantity),
    unit_price: num(v.unitPrice),
    supplier: v.supplier || null,
    used_for: v.usedFor || null,
    note: v.note || null,
  };

  const supabase = await createClient();
  if (entryId === null) {
    const { data, error } = await supabase.from("material_entries").insert({ ...row, site_id: siteId, created_by: userId }).select("id").single();
    if (error || !data) return { ok: false, error: error ? mapError(error) : GENERIC_ERROR };
    revalidatePath(`/sites/${siteId}/malzeme`);
    return { ok: true, id: data.id };
  }
  const { data, error } = await supabase.from("material_entries").update(row).eq("id", entryId).eq("site_id", siteId).select("id");
  if (error) return { ok: false, error: mapError(error) };
  if (!data || data.length === 0) return { ok: false, error: NO_WRITE_ERROR };
  revalidatePath(`/sites/${siteId}/malzeme`);
  return { ok: true, id: entryId };
}

export async function deleteMaterialEntry(siteId: number, entryId: number): Promise<Result> {
  await requireAuthId();
  if (!Number.isInteger(siteId) || !Number.isInteger(entryId)) return { ok: false, error: "Geçersiz istek." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("material_entries").delete().eq("id", entryId).eq("site_id", siteId).select("id");
  if (error) return { ok: false, error: mapError(error) };
  if (!data || data.length === 0) return { ok: false, error: NO_WRITE_ERROR };
  revalidatePath(`/sites/${siteId}/malzeme`);
  return { ok: true };
}
