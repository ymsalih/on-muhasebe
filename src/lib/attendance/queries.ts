import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { WorkInput } from "@/lib/personnel/status";

/** Puantajda gereken personel alanları (hassas sütun YOK). */
const PERSON_COLUMNS =
  "id, full_name, job, duty, status, hire_date, termination_date, temp_assignment_start, report_start, leave_start, return_date, absence_days_count";

export type AttendancePerson = WorkInput & { id: number; full_name: string; job: string | null; duty: string | null };

export async function listAttendancePeople(siteId: number): Promise<AttendancePerson[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("personnel").select(PERSON_COLUMNS).eq("site_id", siteId).order("full_name").limit(1000);
  if (error) throw new Error("personnel okunamadı");
  return (data as unknown as AttendancePerson[]) ?? [];
}

/** Bir günün işaretli personel kimlikleri. */
export async function listPresentIds(siteId: number, date: string): Promise<number[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("attendance").select("personnel_id").eq("site_id", siteId).eq("work_date", date);
  if (error) throw new Error("attendance okunamadı");
  return (data ?? []).map((r) => r.personnel_id as number);
}

/** PostgREST varsayılan 1000 satır sınırını aşmamak için sayfalayarak okur (500 kişi × 31 gün = 15.500 satır). */
async function fetchAll<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const size = 1000;
  const all: T[] = [];
  for (let from = 0; ; from += size) {
    const { data, error } = await page(from, from + size - 1);
    if (error) throw new Error("okuma başarısız");
    all.push(...(data ?? []));
    if (!data || data.length < size) return all;
  }
}

export type MonthData = {
  /** personnel_id → işaretli günler ("YYYY-MM-DD") */
  presentByPerson: Map<number, Set<string>>;
  /** personnel_id → aylık gün sayısı (monthly_attendance_summary view'inden) */
  totals: Map<number, number>;
};

/** `firstDay`/`lastDay`: ayın ilk ve son günü (yyyy-mm-dd). */
export async function getMonthData(siteId: number, firstDay: string, lastDay: string): Promise<MonthData> {
  const supabase = await createClient();

  const rows = await fetchAll<{ personnel_id: number; work_date: string }>((from, to) =>
    supabase
      .from("attendance")
      .select("personnel_id, work_date")
      .eq("site_id", siteId)
      .gte("work_date", firstDay)
      .lte("work_date", lastDay)
      .order("id")
      .range(from, to),
  );

  const presentByPerson = new Map<number, Set<string>>();
  for (const r of rows) {
    const set = presentByPerson.get(r.personnel_id) ?? new Set<string>();
    set.add(r.work_date);
    presentByPerson.set(r.personnel_id, set);
  }

  const summary = await fetchAll<{ personnel_id: number; days_worked: number }>((from, to) =>
    supabase
      .from("monthly_attendance_summary")
      .select("personnel_id, days_worked")
      .eq("site_id", siteId)
      .eq("month", firstDay)
      .order("personnel_id")
      .range(from, to),
  );
  const totals = new Map(summary.map((r) => [r.personnel_id, r.days_worked]));

  return { presentByPerson, totals };
}

/** Dashboard "Bugün Gelen Personel" kartı. */
export async function countPresent(siteId: number, date: string): Promise<number> {
  const supabase = await createClient();
  const { count } = await supabase
    .from("attendance")
    .select("id", { count: "exact", head: true })
    .eq("site_id", siteId)
    .eq("work_date", date);
  return count ?? 0;
}
