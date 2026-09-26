import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { PersonStatus } from "@/lib/personnel/schemas";

/**
 * tc_no ve iban BİLEREK seçilmez (ve seçilemez: sütun yetkisi yok). Yalnızca has_tc_no / has_iban okunur.
 * `select("*")` kullanmayın; hassas sütunlar yüzünden zaten hata verir.
 */
const PERSON_COLUMNS =
  "id, full_name, employer_party_id, insurance_company, job, duty, status, hire_date, termination_date, temp_assignment_start, report_start, leave_start, absence_days_count, return_date, phone, daily_wage, has_tc_no, has_iban, parties(name)";

export type PersonRow = {
  id: number;
  full_name: string;
  employer_party_id: number | null;
  insurance_company: string | null;
  job: string | null;
  duty: string | null;
  status: PersonStatus;
  hire_date: string | null;
  termination_date: string | null;
  temp_assignment_start: string | null;
  report_start: string | null;
  leave_start: string | null;
  absence_days_count: number | null;
  return_date: string | null;
  phone: string | null;
  daily_wage: number | null;
  has_tc_no: boolean;
  has_iban: boolean;
  parties: { name: string } | null;
};

export const PERSON_LIST_LIMIT = 500;

/**
 * Duruma göre süzme burada YAPILMAZ: güncel durum izin/rapor tarihlerinden türetilir (lib/personnel/status.ts),
 * bu yüzden çağıran taraf effectiveStatus ile süzer.
 */
export async function listPersonnel(siteId: number, filters: { q?: string }): Promise<PersonRow[]> {
  const supabase = await createClient();
  let query = supabase.from("personnel").select(PERSON_COLUMNS).eq("site_id", siteId);

  if (filters.q) {
    // % ve _ joker olarak yorumlanmasın
    const escaped = filters.q.replace(/[\\%_]/g, (c) => `\\${c}`);
    query = query.ilike("full_name", `%${escaped}%`);
  }

  const { data, error } = await query.order("full_name").limit(PERSON_LIST_LIMIT);
  if (error) throw new Error("personnel okunamadı");
  return (data as unknown as PersonRow[]) ?? [];
}

export async function getPerson(siteId: number, personId: number): Promise<PersonRow | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("personnel")
    .select(PERSON_COLUMNS)
    .eq("site_id", siteId)
    .eq("id", personId)
    .maybeSingle();
  return (data as unknown as PersonRow | null) ?? null;
}
