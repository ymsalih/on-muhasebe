"use server";

import { revalidatePath } from "next/cache";
import { requireAuthId } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import {
  createPartySchema,
  goodsEntrySchema,
  toDbNumber,
  type GoodsEntryValues,
  type PartyCategory,
} from "@/lib/goods/schemas";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const GENERIC_ERROR = "Kayıt işlemi tamamlanamadı, bağlantınızı kontrol edip tekrar deneyin.";
const NO_WRITE_ERROR = "Bu şantiyede kayıt ekleme/düzenleme yetkiniz yok.";

function mapError(error: { code?: string }): string {
  if (error.code === "42501") return NO_WRITE_ERROR; // RLS reddi
  if (error.code === "23503") return "Seçilen firma bu şantiyeye ait değil.";
  return GENERIC_ERROR;
}

function toRow(values: GoodsEntryValues) {
  return {
    entry_date: values.entryDate,
    document_type: values.documentType,
    document_no: values.documentNo || null,
    party_id: values.partyId ? Number(values.partyId) : null,
    material_type: values.materialType || null,
    unit: values.unit || null,
    variant: values.variant || null,
    quantity: toDbNumber(values.quantity),
    unit_price: toDbNumber(values.unitPrice),
    used_location: values.usedLocation || null,
    purchase_location: values.purchaseLocation || null,
    transport_cost: toDbNumber(values.transportCost) ?? 0,
    info: values.info || null,
  };
}

/**
 * İrsaliye/fatura/fiş kaydı oluşturur veya günceller. Yetki RLS'tedir (owner/partner yazar; viewer ve admin yazamaz);
 * buradaki kontroller yalnızca anlaşılır hata içindir. `created_by` istemciden alınmaz, oturumdan gelir.
 */
export async function saveGoodsEntry(
  siteId: number,
  entryId: number | null,
  input: GoodsEntryValues,
): Promise<Result<{ id: number }>> {
  const userId = await requireAuthId();
  if (!Number.isInteger(siteId)) return { ok: false, error: "Geçersiz şantiye." };

  const parsed = goodsEntrySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Girilen bilgiler geçersiz." };

  const supabase = await createClient();
  const row = toRow(parsed.data);

  if (entryId === null) {
    const { data, error } = await supabase
      .from("goods_entries")
      .insert({ ...row, site_id: siteId, created_by: userId })
      .select("id")
      .single();
    if (error || !data) return { ok: false, error: error ? mapError(error) : GENERIC_ERROR };
    revalidatePath(`/sites/${siteId}/irsaliye`);
    return { ok: true, id: data.id };
  }

  const { data, error } = await supabase
    .from("goods_entries")
    .update(row)
    .eq("id", entryId)
    .eq("site_id", siteId)
    .select("id");
  if (error) return { ok: false, error: mapError(error) };
  if (!data || data.length === 0) return { ok: false, error: NO_WRITE_ERROR }; // RLS satırı süzdü ya da kayıt yok

  revalidatePath(`/sites/${siteId}/irsaliye`);
  return { ok: true, id: entryId };
}

export async function deleteGoodsEntry(siteId: number, entryId: number): Promise<Result> {
  await requireAuthId();
  if (!Number.isInteger(siteId) || !Number.isInteger(entryId)) return { ok: false, error: "Geçersiz istek." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("goods_entries")
    .delete()
    .eq("id", entryId)
    .eq("site_id", siteId)
    .select("id");
  if (error) return { ok: false, error: mapError(error) };
  if (!data || data.length === 0) return { ok: false, error: NO_WRITE_ERROR };

  revalidatePath(`/sites/${siteId}/irsaliye`);
  return { ok: true };
}

export type PartyOption = { id: number; name: string; category: PartyCategory };

/** Form içinden hızlı firma ekleme. Tam cari yönetimi (düzenleme, bakiye, detay) Faz 6'dadır. */
export async function createParty(input: {
  siteId: number;
  name: string;
  category: PartyCategory;
}): Promise<Result<{ party: PartyOption }>> {
  await requireAuthId();

  const parsed = createPartySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Girilen bilgiler geçersiz." };
  const { siteId, name, category } = parsed.data;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("parties")
    .insert({ site_id: siteId, name, category })
    .select("id, name, category")
    .single();

  if (error || !data) {
    if (error?.code === "23505") return { ok: false, error: "Bu adla bir firma/cari zaten var, listeden seçin." };
    return { ok: false, error: error ? mapError(error) : GENERIC_ERROR };
  }

  revalidatePath(`/sites/${siteId}/irsaliye`);
  return { ok: true, party: data as PartyOption };
}
