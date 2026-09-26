import "server-only";
import { cache } from "react";
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
