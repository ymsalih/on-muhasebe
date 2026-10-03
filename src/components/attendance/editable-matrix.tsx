"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/auth/field";
import { MatrixScroll } from "@/components/attendance/matrix-scroll";
import { saveAttendance } from "@/lib/attendance/actions";
import { formatDate } from "@/lib/format";
import { useLiveRefresh } from "@/lib/use-live-refresh";
import { cn } from "@/lib/utils";

/** ok: çalışabilir (dokunulabilir) · İ/R/G: izinli/raporlu/geçici görevde · "-": çalışma dışı · future: gelecek gün */
export type MatrixCode = "ok" | "İ" | "R" | "G" | "-" | "future";
export type MatrixRow = { id: number; name: string; codes: MatrixCode[] };

const WEEKDAYS = ["Pz", "Pt", "Sa", "Ça", "Pe", "Cu", "Ct"];
const CODE_STYLE: Record<"İ" | "R" | "G", { cls: string; label: string }> = {
  İ: { cls: "text-sky-700 dark:text-sky-400", label: "İzinli" },
  R: { cls: "text-orange-700 dark:text-orange-400", label: "Raporlu" },
  G: { cls: "text-violet-700 dark:text-violet-400", label: "Geçici görevde" },
};
const UNDO_MS = 10_000;

type Change = { id: number; name: string; iso: string; marked: boolean };

/**
 * Aylık Özet matrisi: personel × gün. Yetkisi olan kullanıcı bir güne dokunarak işaret koyar/kaldırır
 * (anında kaydolur, hata olursa geri alınır) ve yanlışlıkla yapılan değişikliği "Geri al" ile düzeltir.
 * Yetkisi olmayan (viewer/admin) yalnızca görüntüler.
 */
export function EditableMatrix({
  siteId,
  ym,
  today,
  canWrite,
  rows,
  present: initialPresent,
  notes,
}: {
  siteId: number;
  ym: string;
  today: string;
  canWrite: boolean;
  rows: MatrixRow[];
  present: Record<number, string[]>;
  notes: Record<string, string>;
}) {
  const [present, setPresent] = useState<Map<number, Set<string>>>(
    () => new Map(rows.map((r) => [r.id, new Set(initialPresent[r.id] ?? [])])),
  );
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [last, setLast] = useState<Change | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastLocalChange = useRef(0);

  // Sunucu tek gerçek kaynaktır: sayfa canlı tazelenir ve gelen veri yerel durumu günceller
  // (günlük ekrandan ya da başka sekmeden yapılan işaretler matriste de görünür).
  useLiveRefresh(busy.size === 0);
  useEffect(() => {
    // Kendi yaptığımız iyimser değişiklik sürerken / hemen sonrasında eski veri geri yazılmasın.
    if (busy.size > 0 || Date.now() - lastLocalChange.current < 3000) return;
    setPresent(new Map(rows.map((r) => [r.id, new Set(initialPresent[r.id] ?? [])])));
  }, [initialPresent, rows]); // eslint-disable-line react-hooks/exhaustive-deps

  const [year, month] = ym.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const days = Array.from({ length: daysInMonth }, (_, i) => {
    const iso = `${ym}-${String(i + 1).padStart(2, "0")}`;
    const dow = new Date(`${iso}T00:00:00Z`).getUTCDay();
    return { iso, n: i + 1, dow, weekend: dow === 0 || dow === 6 };
  });

  async function apply(row: MatrixRow, iso: string, mark: boolean, isUndo = false) {
    const key = `${row.id}|${iso}`;
    if (busy.has(key)) return;
    setError(null);
    if (timer.current) clearTimeout(timer.current);
    lastLocalChange.current = Date.now();

    const setMark = (on: boolean) =>
      setPresent((prev) => {
        const next = new Map(prev);
        const set = new Set(next.get(row.id));
        if (on) set.add(iso);
        else set.delete(iso);
        next.set(row.id, set);
        return next;
      });

    setMark(mark); // iyimser güncelleme
    setBusy((b) => new Set(b).add(key));
    const res = await saveAttendance({ siteId, date: iso, add: mark ? [row.id] : [], remove: mark ? [] : [row.id] }).catch(() => null);
    setBusy((b) => {
      const next = new Set(b);
      next.delete(key);
      return next;
    });

    if (!res || !res.ok) {
      setMark(!mark); // geri al
      setError(res && !res.ok ? res.error : "Değişiklik kaydedilemedi, bağlantınızı kontrol edip tekrar deneyin.");
      return;
    }
    if (isUndo) {
      setLast(null);
      return;
    }
    setLast({ id: row.id, name: row.name, iso, marked: mark });
    timer.current = setTimeout(() => setLast(null), UNDO_MS);
  }

  const dayTotals = days.map((d) => rows.filter((r) => present.get(r.id)?.has(d.iso)).length);
  const rowTotal = (id: number) => present.get(id)?.size ?? 0;
  const grandTotal = rows.reduce((sum, r) => sum + rowTotal(r.id), 0);
  const undoRow = last ? rows.find((r) => r.id === last.id) : undefined;

  return (
    <div className="space-y-3">
      <FormError message={error} />

      <div aria-live="polite" className="min-h-0">
        {last && undoRow && (
          <div className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm">
            <span className="min-w-0 flex-1">
              <span className="font-medium">{last.name}</span> · {formatDate(last.iso)} {last.marked ? "işaretlendi" : "işareti kaldırıldı"}
            </span>
            <Button type="button" variant="ghost" className="h-11 shrink-0" onClick={() => apply(undoRow, last.iso, !last.marked, true)}>
              <Undo2 aria-hidden />
              Geri al
            </Button>
          </div>
        )}
      </div>

      <MatrixScroll>
        <table className="min-w-max border-collapse text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              <th scope="col" className="sticky left-0 z-20 min-w-40 border-r bg-muted px-3 py-2 text-left font-semibold">
                Personel
              </th>
              {days.map((d) => (
                <th
                  key={d.iso}
                  scope="col"
                  data-today={d.iso === today ? "" : undefined}
                  className={cn("border-l p-0 font-medium", d.weekend && "bg-muted", d.iso === today && "bg-primary/10")}
                >
                  {d.iso <= today ? (
                    <Link
                      href={`/sites/${siteId}/puantaj?tarih=${d.iso}`}
                      prefetch={false}
                      aria-label={`${d.n} ${WEEKDAYS[d.dow]} günlük puantaja git`}
                      className="flex h-11 min-w-11 flex-col items-center justify-center leading-tight hover:bg-muted/70"
                    >
                      <span>{d.n}</span>
                      <span className="text-[10px] font-normal text-muted-foreground">{WEEKDAYS[d.dow]}</span>
                    </Link>
                  ) : (
                    <span className="flex h-11 min-w-11 flex-col items-center justify-center leading-tight text-muted-foreground">
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
            {rows.map((r) => (
              <tr key={r.id} className="border-b last:border-b-0">
                <th scope="row" className="sticky left-0 z-10 max-w-48 truncate border-r bg-card px-3 py-2 text-left font-medium">
                  {r.name}
                </th>
                {days.map((d, i) => {
                  const code = r.codes[i];
                  const on = present.get(r.id)?.has(d.iso) ?? false;
                  const key = `${r.id}|${d.iso}`;
                  const note = notes[key];
                  const cellCls = cn("relative h-11 min-w-11 border-l p-0 text-center", d.weekend && "bg-muted/40", d.iso > today && "bg-muted/20");

                  // Düzenlenebilir hücre: yazma yetkisi var ve (işaretli ya da o gün çalışabilir)
                  if (canWrite && (on || code === "ok")) {
                    return (
                      <td key={d.iso} className={cellCls}>
                        <button
                          type="button"
                          aria-pressed={on}
                          aria-label={`${r.name}, ${formatDate(d.iso)}: ${on ? "geldi" : "gelmedi"}. Değiştirmek için dokunun`}
                          disabled={busy.has(key)}
                          onClick={() => apply(r, d.iso, !on)}
                          className={cn(
                            "flex h-11 w-full min-w-11 items-center justify-center outline-none focus-visible:ring-2 focus-visible:ring-ring",
                            on ? "font-bold text-emerald-600 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-950/40" : "hover:bg-emerald-50 dark:hover:bg-emerald-950/30",
                            busy.has(key) && "opacity-50",
                          )}
                        >
                          {on ? "✓" : ""}
                        </button>
                        {note && <span title={note} className="pointer-events-none absolute right-1 top-0.5 text-[10px] leading-none text-orange-500">●</span>}
                      </td>
                    );
                  }

                  let content: React.ReactNode = null;
                  let label = "";
                  if (on) {
                    content = <span className="font-bold text-emerald-600 dark:text-emerald-400">✓</span>;
                    label = "Geldi";
                  } else if (code === "İ" || code === "R" || code === "G") {
                    content = <span className={cn("text-xs font-semibold", CODE_STYLE[code].cls)}>{code}</span>;
                    label = CODE_STYLE[code].label;
                  } else if (code === "-") {
                    content = <span className="text-muted-foreground/70">–</span>;
                    label = "Çalışma dışı";
                  }
                  return (
                    <td key={d.iso} title={note ? `${label ? label + " · " : ""}Not: ${note}` : label || undefined} className={cellCls}>
                      <span className="flex h-11 min-w-11 items-center justify-center">{content}</span>
                      {note && <span className="pointer-events-none absolute right-1 top-0.5 text-[10px] leading-none text-orange-500">●</span>}
                    </td>
                  );
                })}
                <td className="sticky right-0 z-10 border-l bg-card px-3 py-2 text-center font-semibold tabular-nums">{rowTotal(r.id)}</td>
              </tr>
            ))}
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
      </MatrixScroll>

      <div className="space-y-1 text-xs text-muted-foreground">
        <p className="flex flex-wrap gap-x-4 gap-y-1">
          <span><span className="font-bold text-emerald-600">✓</span> Geldi</span>
          <span><span className="font-semibold text-sky-700">İ</span> İzinli</span>
          <span><span className="font-semibold text-orange-700">R</span> Raporlu</span>
          <span><span className="font-semibold text-violet-700">G</span> Geçici görevde</span>
          <span>– Çalışma dışı</span>
          <span><span className="text-orange-500">●</span> Notu var</span>
        </p>
        {canWrite ? (
          <p>Bir güne dokunarak işareti ekleyebilir veya kaldırabilirsiniz; yanlışlıkla yaptığınız değişikliği “Geri al” ile düzeltin. Not eklemek için günlük ekranı kullanın.</p>
        ) : (
          <p>Bu ekranı yalnızca görüntüleyebilirsiniz.</p>
        )}
      </div>
    </div>
  );
}
