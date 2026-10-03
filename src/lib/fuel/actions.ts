"use server";

import { revalidatePath } from "next/cache";
import { requireAuthId } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { fuelEntrySchema, num, type FuelEntryValues } from "@/lib/fuel/schemas";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const GENERIC_ERROR = "İşlem tamamlanamadı, bağlantınızı kontrol edip tekrar deneyin.";
const NO_WRITE_ERROR = "Bu şantiyede kayıt ekleme/düzenleme yetkiniz yok.";

function mapError(error: { code?: string }): string {
  switch (error.code) {
    case "42501":
      return NO_WRITE_ERROR;
    case "23503":
      return "Seçilen araç bulunamadı.";
    case "22007":
    case "23514":
      return "Girilen bilgilerden biri geçersiz (litre sıfırdan büyük olmalı, gelecek tarih girilemez).";
    default:
      return GENERIC_ERROR;
  }
}

const refresh = (siteId: number) => revalidatePath(`/sites/${siteId}/yakit`);

/**
 * Yakıt kaydı ekler/günceller. Toplam tutar = litre × litre fiyatı (veritabanı hesaplar, istemciden alınmaz).
 * `owner_id` oturumdan gelir; yetki ve "araç kendi aracınız mı" kuralı veritabanındadır (RLS + bileşik yabancı anahtar).
 */
export async function saveFuelEntry(siteId: number, entryId: number | null, input: FuelEntryValues): Promise<Result<{ id: number }>> {
  const userId = await requireAuthId();
  if (!Number.isInteger(siteId)) return { ok: false, error: "Geçersiz şantiye." };
  const parsed = fuelEntrySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Girilen bilgiler geçersiz." };
  const v = parsed.data;
  const row = {
    machine_id: Number(v.machineId),
    fuel_date: v.date,
    fuel_type: v.fuelType,
    liters: num(v.liters),
    unit_price: num(v.unitPrice),
    fueled_by: v.fueledBy || null,
    station: v.station || null,
    note: v.note || null,
  };

  const supabase = await createClient();
  if (entryId === null) {
    const { data, error } = await supabase.from("fuel_entries").insert({ ...row, site_id: siteId, owner_id: userId }).select("id").single();
    if (error || !data) return { ok: false, error: error ? mapError(error) : GENERIC_ERROR };
    refresh(siteId);
    return { ok: true, id: data.id };
  }
  const { data, error } = await supabase.from("fuel_entries").update(row).eq("id", entryId).eq("site_id", siteId).select("id");
  if (error) return { ok: false, error: mapError(error) };
  if (!data || data.length === 0) return { ok: false, error: NO_WRITE_ERROR };
  refresh(siteId);
  return { ok: true, id: entryId };
}

export async function deleteFuelEntry(siteId: number, entryId: number): Promise<Result> {
  await requireAuthId();
  if (!Number.isInteger(siteId) || !Number.isInteger(entryId)) return { ok: false, error: "Geçersiz istek." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("fuel_entries").delete().eq("id", entryId).eq("site_id", siteId).select("id");
  if (error) return { ok: false, error: mapError(error) };
  if (!data || data.length === 0) return { ok: false, error: NO_WRITE_ERROR };
  refresh(siteId);
  return { ok: true };
}
