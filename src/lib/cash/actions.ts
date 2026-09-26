"use server";

import { revalidatePath } from "next/cache";
import { requireAuthId } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { toDbNumber } from "@/lib/goods/schemas";
import {
  cashTransactionSchema,
  categoryNameSchema,
  createCategorySchema,
  type CashTransactionValues,
  type CashType,
} from "@/lib/cash/schemas";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const GENERIC_ERROR = "İşlem tamamlanamadı, bağlantınızı kontrol edip tekrar deneyin.";
const NO_WRITE_ERROR = "Bu şantiyede kayıt ekleme/düzenleme yetkiniz yok.";

function mapError(error: { code?: string; message?: string }): string {
  switch (error.code) {
    case "42501":
      return NO_WRITE_ERROR;
    case "23503":
      return /Kategori/.test(error.message ?? "")
        ? "Seçilen kategori bu işlem türüne uygun değil."
        : "Bu kayda bağlı hareketler var ya da seçilen kayıt bu şantiyeye ait değil.";
    case "23505":
      return "Bu adla bir kategori zaten var.";
    case "23514":
      return "Girilen bilgilerden biri geçersiz.";
    default:
      return GENERIC_ERROR;
  }
}

/** Kasa hareketleri hem Genel Kasa'da, hem cari detayında, hem dashboard'da görünür: hepsini tazele. */
function refresh(siteId: number) {
  revalidatePath(`/sites/${siteId}`, "layout");
}

/**
 * Gelir/gider hareketi oluşturur veya günceller. `lockedPartyId` (cari detayından) verilirse cari sabittir.
 * Yetki RLS'tedir (owner/partner); user_id oturumdan gelir, istemciden alınmaz.
 */
export async function saveCashTransaction(
  siteId: number,
  txId: number | null,
  input: CashTransactionValues,
  lockedPartyId?: number,
): Promise<Result<{ id: number }>> {
  const userId = await requireAuthId();
  if (!Number.isInteger(siteId)) return { ok: false, error: "Geçersiz şantiye." };

  const parsed = cashTransactionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Girilen bilgiler geçersiz." };
  const v = parsed.data;

  const row = {
    type: v.type,
    amount: toDbNumber(v.amount) as number,
    transaction_date: v.date,
    description: v.description,
    payment_method: v.paymentMethod || null,
    category_id: v.categoryId ? Number(v.categoryId) : null,
    party_id: lockedPartyId ?? (v.partyId ? Number(v.partyId) : null),
  };

  const supabase = await createClient();
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

  const { data, error } = await supabase.from("transactions").update(row).eq("id", txId).eq("site_id", siteId).select("id");
  if (error) return { ok: false, error: mapError(error) };
  if (!data || data.length === 0) return { ok: false, error: NO_WRITE_ERROR };
  refresh(siteId);
  return { ok: true, id: txId };
}

export async function deleteCashTransaction(siteId: number, txId: number): Promise<Result> {
  await requireAuthId();
  if (!Number.isInteger(siteId) || !Number.isInteger(txId)) return { ok: false, error: "Geçersiz istek." };

  const supabase = await createClient();
  const { data, error } = await supabase.from("transactions").delete().eq("id", txId).eq("site_id", siteId).select("id");
  if (error) return { ok: false, error: mapError(error) };
  if (!data || data.length === 0) return { ok: false, error: NO_WRITE_ERROR };
  refresh(siteId);
  return { ok: true };
}

export type CategoryOption = { id: number; site_id: number | null; name: string; type: CashType };

/** Şantiyeye özel kategori ekler (varsayılan kategoriler herkesin; bunlar yalnızca bu şantiyede görünür). */
export async function createCategory(input: { siteId: number; name: string; type: CashType }): Promise<Result<{ category: CategoryOption }>> {
  await requireAuthId();
  const parsed = createCategorySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Girilen bilgiler geçersiz." };
  const { siteId, name, type } = parsed.data;

  const supabase = await createClient();
  const { data, error } = await supabase.from("categories").insert({ site_id: siteId, name, type }).select("id, site_id, name, type").single();
  if (error || !data) return { ok: false, error: error ? mapError(error) : GENERIC_ERROR };
  refresh(siteId);
  return { ok: true, category: data as CategoryOption };
}

export async function renameCategory(siteId: number, categoryId: number, name: string): Promise<Result> {
  await requireAuthId();
  const parsed = categoryNameSchema.safeParse(name);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Geçersiz ad." };
  if (!Number.isInteger(siteId) || !Number.isInteger(categoryId)) return { ok: false, error: "Geçersiz istek." };

  const supabase = await createClient();
  const { data, error } = await supabase.from("categories").update({ name: parsed.data }).eq("id", categoryId).eq("site_id", siteId).select("id");
  if (error) return { ok: false, error: mapError(error) };
  if (!data || data.length === 0) return { ok: false, error: "Varsayılan kategoriler değiştirilemez ya da yetkiniz yok." };
  refresh(siteId);
  return { ok: true };
}

export async function deleteCategory(siteId: number, categoryId: number): Promise<Result> {
  await requireAuthId();
  if (!Number.isInteger(siteId) || !Number.isInteger(categoryId)) return { ok: false, error: "Geçersiz istek." };

  const supabase = await createClient();
  const { data, error } = await supabase.from("categories").delete().eq("id", categoryId).eq("site_id", siteId).select("id");
  if (error) {
    return { ok: false, error: error.code === "23503" ? "Bu kategoriyi kullanan hareketler var; önce hareketlerin kategorisini değiştirin." : mapError(error) };
  }
  if (!data || data.length === 0) return { ok: false, error: "Varsayılan kategoriler silinemez ya da yetkiniz yok." };
  refresh(siteId);
  return { ok: true };
}
