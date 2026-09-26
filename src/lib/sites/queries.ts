import "server-only";
import { cache } from "react";
import { getAuthUserId } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export type SiteRef = { id: number; name: string; status: "active" | "closed" };

/**
 * Kullanıcının erişebildiği şantiyeler. Filtre uygulama kodunda değil RLS'tedir:
 * admin hepsini, ortak yalnızca site_members üzerinden üyesi olduklarını görür.
 */
export const getAccessibleSites = cache(async (): Promise<SiteRef[]> => {
  const supabase = await createClient();
  const { data } = await supabase.from("sites").select("id, name, status").order("name");
  return (data as SiteRef[] | null) ?? [];
});

/** Kullanıcının bu şantiyedeki rolü; üye değilse (ör. admin) null. */
export const getSiteRole = cache(async (siteId: number): Promise<"owner" | "partner" | "viewer" | null> => {
  // Kimlik JWT'den yerel okunur: profil sorgusunu BEKLEMEDEN, onunla paralel çalışabilir.
  const [userId, supabase] = await Promise.all([getAuthUserId(), createClient()]);
  if (!userId) return null;
  const { data } = await supabase
    .from("site_members")
    .select("role")
    .eq("site_id", siteId)
    .eq("user_id", userId)
    .maybeSingle();
  return (data?.role as "owner" | "partner" | "viewer" | undefined) ?? null;
});

/** Veri yazma yetkisi: yalnızca owner ve partner. Viewer ve admin salt okur (RLS aynısını zorlar; bu yalnızca arayüz içindir). */
export function canWriteRole(role: "owner" | "partner" | "viewer" | null): boolean {
  return role === "owner" || role === "partner";
}
