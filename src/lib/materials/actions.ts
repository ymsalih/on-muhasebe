"use server";

import { revalidatePath } from "next/cache";
import { requireAuthId } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { materialSchema, movementSchema, num, type MaterialValues, type MovementValues } from "@/lib/materials/schemas";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const GENERIC_ERROR = "İşlem tamamlanamadı, bağlantınızı kontrol edip tekrar deneyin.";
const NO_WRITE_ERROR = "Bu şantiyede kayıt ekleme/düzenleme yetkiniz yok.";

function mapError(error: { code?: string; message?: string }, ctx: "material" | "movement" | "delete-material"): string {
  switch (error.code) {
    case "42501":
      return NO_WRITE_ERROR;
    case "23505":
      return "Bu ad ve cinste bir malzeme zaten var, listeden seçin.";
    case "23514":
      return /Stok eksiye/.test(error.message ?? "")
        ? ctx === "movement"
          ? "Stok yetersiz: eldeki miktardan fazla çıkış veya kullanılmış bir girişi azaltma/silme yapılamaz."
          : "Stok eksiye düşemez."
        : "Girilen bilgilerden biri geçersiz.";
    case "23503":
      return ctx === "delete-material" ? "Bu malzemenin hareketleri var; silmek için önce hareketlerini silin." : "Seçilen malzeme bu şantiyeye ait değil.";
    default:
      return GENERIC_ERROR;
  }
}

function refresh(siteId: number) {
  revalidatePath(`/sites/${siteId}/malzeme`);
}

export async function saveMaterial(siteId: number, materialId: number | null, input: MaterialValues): Promise<Result<{ id: number }>> {
  await requireAuthId();
  if (!Number.isInteger(siteId)) return { ok: false, error: "Geçersiz şantiye." };
  const parsed = materialSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Girilen bilgiler geçersiz." };
  const row = { name: parsed.data.name, variant: parsed.data.variant || null, unit: parsed.data.unit };

  const supabase = await createClient();
  if (materialId === null) {
    const { data, error } = await supabase.from("materials").insert({ ...row, site_id: siteId }).select("id").single();
    if (error || !data) return { ok: false, error: error ? mapError(error, "material") : GENERIC_ERROR };
    refresh(siteId);
    return { ok: true, id: data.id };
  }
  const { data, error } = await supabase.from("materials").update(row).eq("id", materialId).eq("site_id", siteId).select("id");
  if (error) return { ok: false, error: mapError(error, "material") };
  if (!data || data.length === 0) return { ok: false, error: NO_WRITE_ERROR };
  refresh(siteId);
  return { ok: true, id: materialId };
}

export async function deleteMaterial(siteId: number, materialId: number): Promise<Result> {
  await requireAuthId();
  if (!Number.isInteger(siteId) || !Number.isInteger(materialId)) return { ok: false, error: "Geçersiz istek." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("materials").delete().eq("id", materialId).eq("site_id", siteId).select("id");
  if (error) return { ok: false, error: mapError(error, "delete-material") };
  if (!data || data.length === 0) return { ok: false, error: NO_WRITE_ERROR };
  refresh(siteId);
  return { ok: true };
}

/**
 * Giriş/çıkış hareketi ekler veya günceller. Giriş: alış fiyatı (opsiyonel). Çıkış: fiyat yazılmaz.
 * Stok eksiye düşemez (veritabanı tetikleyicisi korur). Düzenlemede malzeme ve tür değişmez.
 */
export async function saveMovement(siteId: number, movementId: number | null, input: MovementValues): Promise<Result<{ id: number }>> {
  const userId = await requireAuthId();
  if (!Number.isInteger(siteId)) return { ok: false, error: "Geçersiz şantiye." };
  const parsed = movementSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Girilen bilgiler geçersiz." };
  const v = parsed.data;
  const row = {
    movement_date: v.date,
    quantity: num(v.quantity),
    unit_price: v.type === "in" && v.unitPrice !== "" ? num(v.unitPrice) : null,
    counterparty: v.counterparty || null,
    note: v.note || null,
  };

  const supabase = await createClient();
  if (movementId === null) {
    const { data, error } = await supabase
      .from("material_movements")
      .insert({ ...row, site_id: siteId, material_id: Number(v.materialId), movement_type: v.type, created_by: userId })
      .select("id")
      .single();
    if (error || !data) return { ok: false, error: error ? mapError(error, "movement") : GENERIC_ERROR };
    refresh(siteId);
    return { ok: true, id: data.id };
  }
  const { data, error } = await supabase.from("material_movements").update(row).eq("id", movementId).eq("site_id", siteId).select("id");
  if (error) return { ok: false, error: mapError(error, "movement") };
  if (!data || data.length === 0) return { ok: false, error: NO_WRITE_ERROR };
  refresh(siteId);
  return { ok: true, id: movementId };
}

export async function deleteMovement(siteId: number, movementId: number): Promise<Result> {
  await requireAuthId();
  if (!Number.isInteger(siteId) || !Number.isInteger(movementId)) return { ok: false, error: "Geçersiz istek." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("material_movements").delete().eq("id", movementId).eq("site_id", siteId).select("id");
  if (error) return { ok: false, error: mapError(error, "movement") };
  if (!data || data.length === 0) return { ok: false, error: NO_WRITE_ERROR };
  refresh(siteId);
  return { ok: true };
}
