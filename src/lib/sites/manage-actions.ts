"use server";

import { revalidatePath } from "next/cache";
import { requireAuthId } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { createSiteSchema, type CreateSiteValues } from "@/lib/sites/schemas";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const GENERIC_ERROR = "İşlem tamamlanamadı, bağlantınızı kontrol edip tekrar deneyin.";

function mapError(error: { code?: string }, hasDataMessage: string): string {
  switch (error.code) {
    case "42501":
      return "Bu işlem için şantiyenin sahibi veya admin olmanız gerekir.";
    case "55000":
      return hasDataMessage;
    case "P0002":
      return "Kayıt bulunamadı (başka biri silmiş olabilir).";
    case "23514":
      return "Girilen bilgilerden biri geçersiz.";
    default:
      return GENERIC_ERROR;
  }
}

const refresh = (siteId?: number) => {
  revalidatePath("/sites");
  revalidatePath("/admin", "layout");
  if (siteId) revalidatePath(`/sites/${siteId}`, "layout");
};

/** Şantiye adı/adresi/başlangıç tarihini düzenler (sahip veya admin; yetki RPC'de uygulanır). */
export async function updateSiteDetails(siteId: number, input: CreateSiteValues): Promise<Result> {
  await requireAuthId();
  if (!Number.isInteger(siteId)) return { ok: false, error: "Geçersiz istek." };
  const parsed = createSiteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Girilen bilgiler geçersiz." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("update_site_details", {
    p_site_id: siteId,
    p_name: parsed.data.name,
    p_address: parsed.data.address || null,
    p_start_date: parsed.data.startDate || null,
  });
  if (error) return { ok: false, error: mapError(error, GENERIC_ERROR) };
  refresh(siteId);
  return { ok: true };
}

/** Şantiyeyi arşive alır / arşivden çıkarır. Arşivdeki şantiyede veri yazılamaz (veritabanı zorlar). */
export async function setSiteArchived(siteId: number, archived: boolean): Promise<Result> {
  await requireAuthId();
  if (!Number.isInteger(siteId)) return { ok: false, error: "Geçersiz istek." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_site_archived", { p_site_id: siteId, p_archived: archived });
  if (error) return { ok: false, error: mapError(error, GENERIC_ERROR) };
  refresh(siteId);
  return { ok: true };
}

/** Şantiyeyi siler. Herhangi bir ortağın verisi varsa veritabanı reddeder; kullanıcı arşive yönlendirilir. */
export async function deleteSite(siteId: number): Promise<Result> {
  await requireAuthId();
  if (!Number.isInteger(siteId)) return { ok: false, error: "Geçersiz istek." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_site", { p_site_id: siteId });
  if (error) return { ok: false, error: mapError(error, "Bu şantiyede veri var; silinemez. Arşive alabilirsiniz.") };
  refresh();
  return { ok: true };
}
