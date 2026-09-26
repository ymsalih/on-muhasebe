import Link from "next/link";
import { CalendarX2 } from "lucide-react";
import type { AttendancePerson, MonthData } from "@/lib/attendance/queries";
import { workAvailability } from "@/lib/personnel/status";
import { cn } from "@/lib/utils";

const WEEKDAYS = ["Pz", "Pt", "Sa", "Ça", "Pe", "Cu", "Ct"];

/** Aylık Özet matrisi (CLAUDE.md 7.3-E): personel × gün, sağda toplam sütunu. Yatay kaydırmalı; ad ve toplam sabit. */
export function MonthlyMatrix({
  siteId,
  ym,
  today,
  people,
  data,
}: {
  siteId: number;
  ym: string;
  today: string;
  people: AttendancePerson[];
  data: MonthData;
}) {
  const [year, month] = ym.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const days = Array.from({ length: daysInMonth }, (_, i) => {
    const iso = `${ym}-${String(i + 1).padStart(2, "0")}`;
    const dow = new Date(`${iso}T00:00:00Z`).getUTCDay();
    return { iso, n: i + 1, dow, weekend: dow === 0 || dow === 6 };
  });
  const first = days[0].iso;
  const last = days[days.length - 1].iso;

  // Ayda işaretli olan ya da ay içinde çalışabilecek durumdaki herkes satır olur.
  const rows = people.filter((p) => {
    if ((data.presentByPerson.get(p.id)?.size ?? 0) > 0) return true;
    if (p.hire_date && p.hire_date > last) return false;
    if (p.termination_date && p.termination_date < first) return false;
    if (p.status === "ayrildi" && !p.termination_date) return false;
    return true;
  });

  if (rows.length === 0) {
    return (
      <div className="mx-auto flex max-w-sm flex-col items-center gap-3 py-12 text-center">
        <CalendarX2 className="size-10 text-muted-foreground" aria-hidden />
        <h2 className="text-lg font-semibold">Bu ay için puantaj kaydı yok</h2>
        <p className="text-sm text-muted-foreground">Günlük Gelenler ekranından puantaj girildikçe burada görünecek.</p>
      </div>
    );
  }

  const ABSENCE: Record<string, { letter: string; cls: string; label: string }> = {
    İzinli: { letter: "İ", cls: "text-sky-700 dark:text-sky-400", label: "İzinli" },
    Raporlu: { letter: "R", cls: "text-orange-700 dark:text-orange-400", label: "Raporlu" },
    "Geçici Görevde": { letter: "G", cls: "text-violet-700 dark:text-violet-400", label: "Geçici görevde" },
  };

  const dayTotals = days.map((d) => rows.filter((p) => data.presentByPerson.get(p.id)?.has(d.iso)).length);
  const grandTotal = rows.reduce((sum, p) => sum + (data.totals.get(p.id) ?? data.presentByPerson.get(p.id)?.size ?? 0), 0);

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-xl border bg-card">
        <table className="min-w-max border-collapse text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              <th scope="col" className="sticky left-0 z-20 min-w-40 border-r bg-muted px-3 py-2 text-left font-semibold">
                Personel
              </th>
              {days.map((d) => (
                <th key={d.iso} scope="col" className={cn("border-l p-0 font-medium", d.weekend && "bg-muted")}>
                  {d.iso <= today ? (
                    <Link
                      href={`/sites/${siteId}/puantaj?tarih=${d.iso}`}
                      aria-label={`${d.n} ${WEEKDAYS[d.dow]} günlük puantaja git`}
                      className="flex h-11 min-w-11 flex-col items-center justify-center leading-tight hover:bg-muted/70"
                    >
                      <span>{d.n}</span>
                      <span className="text-[10px] font-normal text-muted-foreground">{WEEKDAYS[d.dow]}</span>
                    </Link>
                  ) : (
                    <span className="flex h-11 min-w-11 flex-col items-center justify-center leading-tight text-muted-foreground/60">
                      <span>{d.n}</span>
                      <span className="text-[10px] font-normal">{WEEKDAYS[d.dow]}</span>
                    </span>
                  )}
                </th>
              ))}
              <th scope="col" className="sticky right-0 z-20 min-w-16 border-l bg-muted px-3 py-2 text-center font-semibold">
                Toplam
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => {
              const present = data.presentByPerson.get(p.id);
              const total = data.totals.get(p.id) ?? present?.size ?? 0;
              return (
                <tr key={p.id} className="border-b last:border-b-0">
                  <th scope="row" className="sticky left-0 z-10 max-w-48 truncate border-r bg-card px-3 py-2 text-left font-medium">
                    {p.full_name}
                  </th>
                  {days.map((d) => {
                    let content: React.ReactNode = null;
                    let label = "";
                    if (present?.has(d.iso)) {
                      content = <span className="font-bold text-emerald-600 dark:text-emerald-400">✓</span>;
                      label = "Geldi";
                    } else if (d.iso <= today) {
                      const a = workAvailability(p, d.iso);
                      if (!a.workable && a.reason) {
                        const ab = ABSENCE[a.reason];
                        content = ab ? <span className={cn("text-xs font-semibold", ab.cls)}>{ab.letter}</span> : <span className="text-muted-foreground/50">–</span>;
                        label = ab?.label ?? a.reason;
                      }
                    }
                    return (
                      <td
                        key={d.iso}
                        title={label || undefined}
                        className={cn("h-11 min-w-11 border-l text-center", d.weekend && "bg-muted/40", d.iso > today && "bg-muted/20")}
                      >
                        {content}
                      </td>
                    );
                  })}
                  <td className="sticky right-0 z-10 border-l bg-card px-3 py-2 text-center font-semibold tabular-nums">{total}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t bg-muted/50 font-semibold">
              <th scope="row" className="sticky left-0 z-10 border-r bg-muted px-3 py-2 text-left">
                Gelen
              </th>
              {dayTotals.map((n, i) => (
                <td key={days[i].iso} className="h-11 min-w-11 border-l text-center tabular-nums text-muted-foreground">
                  {n > 0 ? n : ""}
                </td>
              ))}
              <td className="sticky right-0 z-10 border-l bg-muted px-3 py-2 text-center tabular-nums">{grandTotal}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span><span className="font-bold text-emerald-600">✓</span> Geldi</span>
        <span><span className="font-semibold text-sky-700">İ</span> İzinli</span>
        <span><span className="font-semibold text-orange-700">R</span> Raporlu</span>
        <span><span className="font-semibold text-violet-700">G</span> Geçici görevde</span>
        <span>– Çalışma dışı (işe girmemiş / ayrılmış)</span>
      </p>
    </div>
  );
}
