import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { DocumentType, PartyCategory } from "@/lib/goods/schemas";

export type EntryRow = {
  id: number;
  entry_date: string;
  document_type: DocumentType;
  document_no: string | null;
  party_id: number | null;
  material_type: string | null;
  unit: string | null;
  variant: string | null;
  quantity: number | null;
  unit_price: number | null;
  total_amount: number | null;
  used_location: string | null;
  purchase_location: string | null;
  transport_cost: number;
  info: string | null;
  parties: { name: string } | null;
};

const ENTRY_COLUMNS =
  "id, entry_date, document_type, document_no, party_id, material_type, unit, variant, quantity, unit_price, total_amount, used_location, purchase_location, transport_cost, info, parties(name)";

/** Listede gösterilecek en fazla kayıt; daha eskiler Faz 8'deki raporlama/filtrelerle taranacak. */
export const ENTRY_LIST_LIMIT = 300;

export const listEntries = cache(async (siteId: number): Promise<EntryRow[]> => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("goods_entries")
    .select(ENTRY_COLUMNS)
    .eq("site_id", siteId)
    .order("entry_date", { ascending: false })
    .order("id", { ascending: false })
    .limit(ENTRY_LIST_LIMIT);
  if (error) throw new Error("goods_entries okunamadı");
  return (data as unknown as EntryRow[]) ?? [];
});

export async function getEntry(siteId: number, entryId: number): Promise<EntryRow | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("goods_entries")
    .select(ENTRY_COLUMNS)
    .eq("site_id", siteId)
    .eq("id", entryId)
    .maybeSingle();
  return (data as unknown as EntryRow | null) ?? null;
}

export type PartyRow = { id: number; name: string; category: PartyCategory };

export async function listParties(siteId: number): Promise<PartyRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("parties").select("id, name, category").eq("site_id", siteId).order("name");
  if (error) throw new Error("parties okunamadı");
  return (data as PartyRow[]) ?? [];
}

export type Suggestions = {
  materials: string[];
  units: string[];
  variants: string[];
  usedLocations: string[];
  purchaseLocations: string[];
};

/** Formdaki otomatik tamamlama önerileri: bu şantiyede daha önce girilmiş değerler. */
export async function getSuggestions(siteId: number): Promise<Suggestions> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("goods_entries")
    .select("material_type, unit, variant, used_location, purchase_location")
    .eq("site_id", siteId)
    .order("id", { ascending: false })
    .limit(300);

  const uniq = (key: "material_type" | "unit" | "variant" | "used_location" | "purchase_location") =>
    [...new Set((data ?? []).map((r) => r[key]).filter((v): v is string => !!v))].slice(0, 50);

  return {
    materials: uniq("material_type"),
    units: uniq("unit"),
    variants: uniq("variant"),
    usedLocations: uniq("used_location"),
    purchaseLocations: uniq("purchase_location"),
  };
}
