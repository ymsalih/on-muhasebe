import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { WorkInput } from "@/lib/personnel/status";

/** Puantajda gereken personel alanları (hassas sütun YOK). */
const PERSON_COLUMNS =
  "id, full_name, job, duty, status, hire_date, termination_date, temp_assignment_start, report_start, leave_start, return_date, absence_days_count, daily_wage";

export type AttendancePerson = WorkInput & { id: number; full_name: string; job: string | null; duty: string | null; daily_wage: number | null };

export async function listAttendancePeople(siteId: number): Promise<AttendancePerson[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("personnel").select(PERSON_COLUMNS).eq("site_id", siteId).order("full_name").limit(1000);
  if (error) throw new Error("personnel okunamadı");
  return (data as unknown as AttendancePerson[]) ?? [];
}

export type PresentRow = {
  personnelId: number;
  note: string | null;
  /** İşareti koyan kişinin adı (varsa) */
  markedBy: string | null;
  /** ISO zaman damgası */
  markedAt: string;
};

/** Bir günün işaretli personeli; not, işaretleyen ve saat bilgisiyle. */
export async function listPresent(siteId: number, date: string): Promise<PresentRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("attendance")
    .select("personnel_id, note, created_at, users(full_name)")
    .eq("site_id", siteId)
    .eq("work_date", date);
  if (error) throw new Error("attendance okunamadı");
  return ((data ?? []) as unknown as { personnel_id: number; note: string | null; created_at: string; users: { full_name: string } | null }[]).map((r) => ({
    personnelId: r.personnel_id,
    note: r.note,
    markedBy: r.users?.full_name ?? null,
    markedAt: r.created_at,
  }));
}

export type MonthData = {
  /** personnel_id → işaretli günler ("YYYY-MM-DD") */
  presentByPerson: Map<number, Set<string>>;
  /** "personnel_id|YYYY-MM-DD" → not */
  notes: Map<string, string>;
  /** personnel_id → aylık gün sayısı */
  totals: Map<number, number>;
};

/**
 * Bir ayın puantajı TEK çağrıda: get_month_attendance RPC'si kişi başına tek satır (işaretli günler + notlar) döner.
 * (Önceki yöntem 1000'erli sayfalarla art arda N istek + özet view'iydi: 4,5 sn; şimdi tek çağrı, ~7 ms sorgu süresi.)
 * `firstDay`/`lastDay`: ayın ilk ve son günü (yyyy-mm-dd).
 */
export async function getMonthData(siteId: number, firstDay: string, lastDay: string): Promise<MonthData> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_month_attendance", { p_site_id: siteId, p_first: firstDay, p_last: lastDay });
  if (error) throw new Error("aylık puantaj okunamadı");

  const presentByPerson = new Map<number, Set<string>>();
  const notes = new Map<string, string>();
  const totals = new Map<number, number>();
  for (const r of (data ?? []) as { personnel_id: number; days: string[]; notes: Record<string, string> }[]) {
    presentByPerson.set(r.personnel_id, new Set(r.days));
    totals.set(r.personnel_id, r.days.length);
    for (const [date, note] of Object.entries(r.notes ?? {})) notes.set(`${r.personnel_id}|${date}`, note);
  }
  return { presentByPerson, notes, totals };
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
