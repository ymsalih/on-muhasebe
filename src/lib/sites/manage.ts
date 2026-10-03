import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { DataSummary } from "@/lib/sites/data-labels";

const toNum = (v: unknown) => Number(v ?? 0);
const normalize = (counts: Record<string, unknown>): Record<string, number> => Object.fromEntries(Object.entries(counts ?? {}).map(([k, v]) => [k, toNum(v)]));

/** Şantiyedeki tüm veri (her ortağın özel verisi dahil) ve üye sayısı. Yalnızca sahip/admin (RPC reddeder). */
export async function getSiteDataSummary(siteId: number): Promise<(DataSummary & { members: number }) | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_site_data_summary", { p_site_id: siteId });
  if (error || !data) return null;
  const d = data as { counts: Record<string, unknown>; total: unknown; members: unknown };
  return { counts: normalize(d.counts), total: toNum(d.total), members: toNum(d.members) };
}

/** Üye başına, bu şantiyedeki kendi veri toplamı (çıkar / arşive al kararı). Yalnızca sahip/admin. */
export async function getMemberDataTotals(siteId: number): Promise<Record<string, number>> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("get_member_data_totals", { p_site_id: siteId });
  return Object.fromEntries(((data ?? []) as { user_id: string; total: number | string }[]).map((r) => [r.user_id, toNum(r.total)]));
}

/** Ortak hesabının tüm şantiyelerdeki veri özeti. Yalnızca admin. */
export async function getUserDataSummary(userId: string): Promise<(DataSummary & { ownedSites: number; memberSites: number }) | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_user_data_summary", { p_user_id: userId });
  if (error || !data) return null;
  const d = data as { counts: Record<string, unknown>; total: unknown; owned_sites: unknown; member_sites: unknown };
  return { counts: normalize(d.counts), total: toNum(d.total), ownedSites: toNum(d.owned_sites), memberSites: toNum(d.member_sites) };
}
