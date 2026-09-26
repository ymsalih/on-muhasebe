"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { addMemberSchema, createSiteSchema, type AddMemberValues, type CreateSiteValues } from "@/lib/sites/schemas";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const GENERIC_ERROR = "İşlem tamamlanamadı, bağlantınızı kontrol edip tekrar deneyin.";
const NOT_OWNER_ERROR = "Bu işlem için şantiyenin sahibi olmanız gerekir.";

/**
 * Yeni şantiye (CLAUDE.md Bölüm 1 ve 3): her ortak kendi panelinden oluşturur, oluşturan otomatik owner olur.
 * Şantiye + owner üyeliği create_site RPC'sinde tek işlemdir. Asıl yetki kontrolü RLS'tedir:
 * admin hesabı burada da veritabanı tarafından reddedilir; aşağıdaki kontrol yalnızca anlaşılır hata içindir.
 */
export async function createSite(input: CreateSiteValues): Promise<Result<{ siteId: number }>> {
  const profile = await requireUser();
  if (profile.role === "admin") {
    return { ok: false, error: "Admin hesabıyla şantiye oluşturulamaz. Şantiyeleri ortaklar kendi panelinden ekler." };
  }

  const parsed = createSiteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Girilen bilgiler geçersiz." };
  const { name, address, startDate } = parsed.data;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_site", {
    p_name: name,
    p_address: address || null,
    p_start_date: startDate || null,
  });

  if (error || typeof data !== "number") return { ok: false, error: GENERIC_ERROR };

  revalidatePath("/sites");
  return { ok: true, siteId: data };
}

export type UserSearchResult = { id: string; fullName: string; email: string };

/** Şantiyeye eklenebilecek ortakları arar. Yalnızca şantiyenin sahibi kullanabilir (RPC içinde doğrulanır). */
export async function searchUsersForSite(siteId: number, query: string): Promise<Result<{ users: UserSearchResult[] }>> {
  await requireUser();
  if (!Number.isInteger(siteId) || typeof query !== "string") return { ok: false, error: "Geçersiz istek." };
  if (query.trim().length < 2) return { ok: true, users: [] };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("search_users_for_site", { p_site_id: siteId, p_query: query.slice(0, 100) });

  if (error) return { ok: false, error: error.code === "42501" ? NOT_OWNER_ERROR : GENERIC_ERROR };

  return {
    ok: true,
    users: ((data ?? []) as { id: string; full_name: string; email: string }[]).map((u) => ({
      id: u.id,
      fullName: u.full_name,
      email: u.email,
    })),
  };
}

/** Sahibi olduğu şantiyeye sistemde zaten hesabı olan bir ortağı üye olarak ekler. */
export async function addSiteMember(input: AddMemberValues): Promise<Result> {
  await requireUser();

  const parsed = addMemberSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Girilen bilgiler geçersiz." };
  const { siteId, userId, role, sharePercentage } = parsed.data;

  const supabase = await createClient();

  if (sharePercentage !== null) {
    const { data: current } = await supabase.from("site_members").select("share_percentage").eq("site_id", siteId);
    const total = (current ?? []).reduce((sum, m) => sum + Number(m.share_percentage ?? 0), 0);
    if (total + sharePercentage > 100.0001) {
      return { ok: false, error: `Kâr payları toplamı 100'ü geçemez (şu an %${total} dağıtılmış).` };
    }
  }

  const { error } = await supabase
    .from("site_members")
    .insert({ site_id: siteId, user_id: userId, role, share_percentage: sharePercentage });

  if (error) {
    if (error.code === "23505") return { ok: false, error: "Bu ortak zaten şantiyenin üyesi." };
    if (error.code === "42501") return { ok: false, error: NOT_OWNER_ERROR };
    return { ok: false, error: GENERIC_ERROR };
  }

  revalidatePath(`/sites/${siteId}/ortaklar`);
  return { ok: true };
}

/** Sahip, sahip olmayan bir üyeyi şantiyeden çıkarır (RLS: owner satırı silinemez). */
export async function removeSiteMember(siteId: number, memberId: number): Promise<Result> {
  await requireUser();
  if (!Number.isInteger(siteId) || !Number.isInteger(memberId)) return { ok: false, error: "Geçersiz istek." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("site_members")
    .delete()
    .eq("id", memberId)
    .eq("site_id", siteId)
    .select("id");

  if (error) return { ok: false, error: GENERIC_ERROR };
  if (!data || data.length === 0) return { ok: false, error: NOT_OWNER_ERROR };

  revalidatePath(`/sites/${siteId}/ortaklar`);
  return { ok: true };
}
