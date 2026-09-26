import { CalendarX2 } from "lucide-react";
import { EditableMatrix, type MatrixCode, type MatrixRow } from "@/components/attendance/editable-matrix";
import type { AttendancePerson, MonthData } from "@/lib/attendance/queries";
import { workAvailability } from "@/lib/personnel/status";

/**
 * Aylık Özet matrisi (CLAUDE.md 7.3-E). Sunucuda her hücrenin "o gün çalışabilir mi / neden çalışamaz" kodu hesaplanır;
 * etkileşim (dokunarak işaret koyma/kaldırma, geri al) istemci bileşeninde (EditableMatrix) yapılır.
 */
export function MonthlyMatrix({
  siteId,
  ym,
  today,
  people,
  data,
  canWrite,
}: {
  siteId: number;
  ym: string;
  today: string;
  people: AttendancePerson[];
  data: MonthData;
  canWrite: boolean;
}) {
  const [year, month] = ym.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const isoDays = Array.from({ length: daysInMonth }, (_, i) => `${ym}-${String(i + 1).padStart(2, "0")}`);
  const first = isoDays[0];
  const last = isoDays[isoDays.length - 1];

  // Ayda işaretli olan ya da ay içinde çalışabilecek durumdaki herkes satır olur.
  const visible = people.filter((p) => {
    if ((data.presentByPerson.get(p.id)?.size ?? 0) > 0) return true;
    if (p.hire_date && p.hire_date > last) return false;
    if (p.termination_date && p.termination_date < first) return false;
    if (p.status === "ayrildi" && !p.termination_date) return false;
    return true;
  });

  if (visible.length === 0) {
    return (
      <div className="mx-auto flex max-w-sm flex-col items-center gap-3 py-12 text-center">
        <CalendarX2 className="size-10 text-muted-foreground" aria-hidden />
        <h2 className="text-lg font-semibold">Bu ay için puantaj kaydı yok</h2>
        <p className="text-sm text-muted-foreground">Günlük Gelenler ekranından puantaj girildikçe burada görünecek.</p>
      </div>
    );
  }

  const CODE_BY_REASON: Record<string, MatrixCode> = { İzinli: "İ", Raporlu: "R", "Geçici Görevde": "G" };

  const rows: MatrixRow[] = visible.map((p) => ({
    id: p.id,
    name: p.full_name,
    codes: isoDays.map((iso): MatrixCode => {
      if (iso > today) return "future";
      const a = workAvailability(p, iso);
      if (a.workable) return "ok";
      return (a.reason && CODE_BY_REASON[a.reason]) || "-";
    }),
  }));

  const present: Record<number, string[]> = {};
  for (const p of visible) present[p.id] = [...(data.presentByPerson.get(p.id) ?? [])];

  return (
    <EditableMatrix
      siteId={siteId}
      ym={ym}
      today={today}
      canWrite={canWrite}
      rows={rows}
      present={present}
      notes={Object.fromEntries(data.notes)}
    />
  );
}
