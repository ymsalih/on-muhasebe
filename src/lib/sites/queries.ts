import "server-only";
import { cache } from "react";
import { getAuthUserId } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export type SiteRef = { id: number; name: string; status: "active" | "closed" | "archived" };

/**
 * Kullanıcının erişebildiği şantiyeler. Filtre uygulama kodunda değil RLS'tedir:
 * admin hepsini, ortak yalnızca site_members üzerinden üyesi olduklarını görür.
 */
export const getAccessibleSites = cache(async (): Promise<SiteRef[]> => {
  const supabase = await createClient();
  const { data } = await supabase.from("sites").select("id, name, status").order("name");
  return (data as SiteRef[] | null) ?? [];
});

export type SiteAccess = {
  /** Üyelikteki gerçek rol; üye değilse (ör. admin) null */
  role: "owner" | "partner" | "viewer" | null;
  /** Şantiye arşivde mi? (üye değilse bilinmez → false) */
  siteArchived: boolean;
  /** Bu kullanıcının bu şantiyedeki üyeliği arşivde mi? */
  memberArchived: boolean;
};

/** Kullanıcının bu şantiyedeki erişimi (rol + arşiv durumu). Tek sorgu; aynı istekte önbelleğe alınır. */
export const getSiteAccess = cache(async (siteId: number): Promise<SiteAccess> => {
  // Kimlik JWT'den yerel okunur: profil sorgusunu BEKLEMEDEN, onunla paralel çalışabilir.
  const [userId, supabase] = await Promise.all([getAuthUserId(), createClient()]);
  if (!userId) return { role: null, siteArchived: false, memberArchived: false };
  const { data } = await supabase
    .from("site_members")
    .select("role, archived_at, sites(status)")
    .eq("site_id", siteId)
    .eq("user_id", userId)
    .maybeSingle();
  const row = data as unknown as { role: "owner" | "partner" | "viewer"; archived_at: string | null; sites: { status: string } | null } | null;
  return {
    role: row?.role ?? null,
    siteArchived: row?.sites?.status === "archived",
    memberArchived: !!row?.archived_at,
  };
});

/**
 * Kullanıcının bu şantiyedeki ETKİN rolü: şantiye veya üyelik arşivdeyse veri yazamaz, yani "viewer" gibi davranır
 * (veritabanı da aynısını zorlar). Sahiplik/yönetim kararları için gerçek rol: getSiteAccess().role.
 */
export const getSiteRole = cache(async (siteId: number): Promise<"owner" | "partner" | "viewer" | null> => {
  const a = await getSiteAccess(siteId);
  if (!a.role) return null;
  return a.siteArchived || a.memberArchived ? "viewer" : a.role;
});

/** Veri yazma yetkisi: yalnızca owner ve partner. Viewer ve admin salt okur (RLS aynısını zorlar; bu yalnızca arayüz içindir). */
export function canWriteRole(role: "owner" | "partner" | "viewer" | null): boolean {
  return role === "owner" || role === "partner";
}
