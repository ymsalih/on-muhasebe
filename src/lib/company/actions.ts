"use server";

import { revalidatePath } from "next/cache";
import { requireAuthId } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { toDbNumber } from "@/lib/goods/schemas";
import { companyEntrySchema, type CompanyEntryValues } from "@/lib/company/schemas";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const GENERIC_ERROR = "İşlem tamamlanamadı, bağlantınızı kontrol edip tekrar deneyin.";
const NO_WRITE_ERROR = "Bu kaydı değiştirme yetkiniz yok (yalnızca kendi kayıtlarınızı değiştirebilirsiniz).";

function refresh() {
  revalidatePath("/sirket");
  revalidatePath("/admin/sirketler", "layout");
}

/**
 * Şirket kasası kaydı ekler veya günceller. Sahip oturumdan alınır (istemciden gelmez). Yetki RLS'tedir:
 * yalnızca ortak kendi kaydını yazar; admin yazamaz.
 */
export async function saveCompanyEntry(entryId: number | null, input: CompanyEntryValues): Promise<Result<{ id: number }>> {
  const userId = await requireAuthId();
  const parsed = companyEntrySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Girilen bilgiler geçersiz." };
  const v = parsed.data;
  const row = {
    entry_type: v.type,
    entry_date: v.date,
    description: v.description,
    amount: toDbNumber(v.amount) as number,
  };

  const supabase = await createClient();
  if (entryId === null) {
    const { data, error } = await supabase.from("company_entries").insert({ ...row, owner_id: userId }).select("id").single();
    if (error || !data) return { ok: false, error: error?.code === "42501" ? NO_WRITE_ERROR : GENERIC_ERROR };
    refresh();
    return { ok: true, id: data.id };
  }

  const { data, error } = await supabase.from("company_entries").update(row).eq("id", entryId).eq("owner_id", userId).select("id");
  if (error) return { ok: false, error: error.code === "42501" ? NO_WRITE_ERROR : GENERIC_ERROR };
  if (!data || data.length === 0) return { ok: false, error: NO_WRITE_ERROR };
  refresh();
  return { ok: true, id: entryId };
}

export async function deleteCompanyEntry(entryId: number): Promise<Result> {
  const userId = await requireAuthId();
  if (!Number.isInteger(entryId)) return { ok: false, error: "Geçersiz istek." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("company_entries").delete().eq("id", entryId).eq("owner_id", userId).select("id");
  if (error) return { ok: false, error: error.code === "42501" ? NO_WRITE_ERROR : GENERIC_ERROR };
  if (!data || data.length === 0) return { ok: false, error: NO_WRITE_ERROR };
  refresh();
  return { ok: true };
}
