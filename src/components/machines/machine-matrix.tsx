"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { CalendarX2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/auth/field";
import { MatrixScroll } from "@/components/attendance/matrix-scroll";
import { saveMachineDay, setMachineAttendance } from "@/lib/machines/actions";
import { markConfirmText, unmarkConfirmText, type PaidInfo } from "@/lib/machines/unmark";
import { MACHINE_TYPE_LABELS, machineWorkable } from "@/lib/machines/schemas";
import type { DayEntry, MachineRow } from "@/lib/machines/queries";
import { formatDate, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

const WEEKDAYS = ["Pz", "Pt", "Sa", "Ça", "Pe", "Cu", "Ct"];
const hoursText = (h: number | null) => (h == null ? "" : String(h).replace(".", ","));

/**
 * Aylık Özet (iş makineleri): makine × gün matrisi. Yetkisi olan bir güne dokunarak işaret koyar/kaldırır (anında kaydolur,
 * hata olursa geri alınır). Saat girilmiş günde ✓ yerine saat görünür. Sağda gün ve toplam saat. Saat/not günlük ekrandan girilir.
 */
export function MachineMatrix({
  siteId,
  ym,
  today,
  machines,
  data,
  paid,
  canWrite,
  dayBase,
  ownerId,
}: {
  siteId: number;
  ym: string;
  today: string;
  machines: MachineRow[];
  data: Record<number, Record<string, DayEntry>>;
  /** Bu ay makine başına yapılmış kira ödemeleri (işaret kaldırma onayı için) */
  paid: Record<number, PaidInfo>;
  canWrite: boolean;
  /** Günlük ekranın adresi (başlıktaki gün numarası bağlantısı için); sunucudan istemciye fonksiyon geçirilemediği için düz değerler */
  dayBase: string;
  /** Yalnızca admin: seçili ortak (bağlantılarda korunur) */
  ownerId?: string;
}) {
  const dayHref = (iso: string) => `${dayBase}?${ownerId ? `ortak=${ownerId}&` : ""}tarih=${iso}`;
  const [days, setDays] = useState<Record<number, Record<string, DayEntry>>>(data);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(0);
  // Kaldırılan işaret 10 sn içinde saat ve notuyla birlikte geri getirilebilir
  const [undo, setUndo] = useState<{ m: MachineRow; iso: string; entry: DayEntry } | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [year, month] = ym.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const cols = Array.from({ length: daysInMonth }, (_, i) => {
    const iso = `${ym}-${String(i + 1).padStart(2, "0")}`;
    const dow = new Date(`${iso}T00:00:00Z`).getUTCDay();
    return { iso, n: i + 1, dow, weekend: dow === 0 || dow === 6 };
  });
  const first = cols[0].iso;
  const last = cols[cols.length - 1].iso;

  // Ayda işaretli olan ya da ay içinde çalışabilecek (ayrılmamış) her makine satır olur.
  const rows = machines.filter((m) => {
    if (Object.keys(days[m.id] ?? {}).length > 0) return true;
    if (m.start_date && m.start_date > last) return false;
    if (m.end_date && m.end_date < first) return false;
    return m.status !== "left" || !!m.end_date;
  });

  async function apply(m: MachineRow, iso: string, mark: boolean) {
    const key = `${m.id}|${iso}`;
    if (busy.has(key)) return;
    setError(null);
    const prev = days[m.id]?.[iso];
    // Yanlışlıkla dokunmaya karşı: saat/not ya da kira ödemesi varsa işareti kaldırmadan önce sor.
    if (!mark && prev) {
      const text = unmarkConfirmText(m.name, iso, prev, paid[m.id]);
      if (text && !window.confirm(text)) return;
    } else if (mark) {
      // Ay tam ödenmişse yeni gün ödemeyi de artırır: önce sor
      const text = markConfirmText(m.name, iso, paid[m.id]);
      if (text && !window.confirm(text)) return;
    }
    inFlight.current += 1;
    const set = (v: DayEntry | undefined) =>
      setDays((p) => {
        const cur = { ...(p[m.id] ?? {}) };
        if (v) cur[iso] = v;
        else delete cur[iso];
        return { ...p, [m.id]: cur };
      });
    set(mark ? { hours: null, note: null } : undefined); // iyimser güncelleme
    setBusy((b) => new Set(b).add(key));
    const res = await setMachineAttendance({ siteId, date: iso, add: mark ? [m.id] : [], remove: mark ? [] : [m.id] }).catch(() => null);
    setBusy((b) => {
      const n = new Set(b);
      n.delete(key);
      return n;
    });
    inFlight.current -= 1;
    if (!res || !res.ok) {
      set(prev); // geri al
      setError(res && !res.ok ? res.error : "Değişiklik kaydedilemedi, bağlantınızı kontrol edip tekrar deneyin.");
      return;
    }
    if (!mark && prev) {
      setUndo({ m, iso, entry: prev });
      if (undoTimer.current) clearTimeout(undoTimer.current);
      undoTimer.current = setTimeout(() => setUndo(null), 10_000);
    }
  }

  /** Kaldırılan işareti saat ve notuyla birlikte geri getirir. */
  async function restore() {
    if (!undo) return;
    const { m, iso, entry } = undo;
    setError(null);
    const res = await setMachineAttendance({ siteId, date: iso, add: [m.id], remove: [] }).catch(() => null);
    let ok = !!res && res.ok;
    if (ok && (entry.hours != null || entry.note)) {
      const r2 = await saveMachineDay(siteId, m.id, iso, { hours: entry.hours == null ? "" : String(entry.hours), note: entry.note ?? "" }).catch(() => null);
      ok = !!r2 && r2.ok;
    }
    if (!ok) return setError("Geri alınamadı, bağlantınızı kontrol edip tekrar deneyin.");
    setDays((p) => ({ ...p, [m.id]: { ...(p[m.id] ?? {}), [iso]: entry } }));
    setUndo(null);
  }

  if (rows.length === 0) {
    return (
      <div className="mx-auto flex max-w-sm flex-col items-center gap-3 py-12 text-center">
        <CalendarX2 className="size-10 text-muted-foreground" aria-hidden />
        <h2 className="text-lg font-semibold">Bu ay için makine puantajı yok</h2>
        <p className="text-sm text-muted-foreground">Makine ekleyip Günlük Gelenler ekranından puantaj girildikçe burada görünecek.</p>
      </div>
    );
  }

  const totalDays = (id: number) => Object.keys(days[id] ?? {}).length;
  const totalHours = (id: number) => Object.values(days[id] ?? {}).reduce((s, e) => s + (e.hours ?? 0), 0);
  const dayTotals = cols.map((c) => rows.filter((m) => days[m.id]?.[c.iso]).length);

  return (
    <div className="space-y-3">
      <FormError message={error} />
      <div aria-live="polite">
        {undo && (
          <div className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm">
            <span className="min-w-0 flex-1">
              <span className="font-medium">{undo.m.name}</span> · {formatDate(undo.iso)} işareti kaldırıldı
            </span>
            <Button type="button" variant="ghost" className="h-11 shrink-0" onClick={restore}>
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
                Makine
              </th>
              {cols.map((c) => (
                <th key={c.iso} scope="col" data-today={c.iso === today ? "" : undefined} className={cn("border-l p-0 font-medium", c.weekend && "bg-muted", c.iso === today && "bg-primary/10")}>
                  {c.iso <= today ? (
                    <Link href={dayHref(c.iso)} prefetch={false} aria-label={`${c.n} ${WEEKDAYS[c.dow]} günlük makine puantajına git`} className="flex h-11 min-w-11 flex-col items-center justify-center leading-tight hover:bg-muted/70">
                      <span>{c.n}</span>
                      <span className="text-[10px] font-normal text-muted-foreground">{WEEKDAYS[c.dow]}</span>
                    </Link>
                  ) : (
                    <span className="flex h-11 min-w-11 flex-col items-center justify-center leading-tight text-muted-foreground/60">
                      <span>{c.n}</span>
                      <span className="text-[10px] font-normal">{WEEKDAYS[c.dow]}</span>
                    </span>
                  )}
                </th>
              ))}
              <th scope="col" className="min-w-14 border-l bg-muted px-2 py-2 text-center font-semibold">
                Gün
              </th>
              <th scope="col" className="sticky right-0 z-20 min-w-16 border-l bg-muted px-2 py-2 text-center font-semibold">
                Saat
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => (
              <tr key={m.id} className="border-b last:border-b-0">
                <th scope="row" className="sticky left-0 z-10 max-w-48 border-r bg-card px-3 py-2 text-left font-medium">
                  <span className="block truncate">{m.name}</span>
                  <span className="block truncate text-[11px] font-normal text-muted-foreground">{[MACHINE_TYPE_LABELS[m.machine_type], m.identifier].filter(Boolean).join(" · ")}</span>
                </th>
                {cols.map((c) => {
                  const entry = days[m.id]?.[c.iso];
                  const on = !!entry;
                  const key = `${m.id}|${c.iso}`;
                  const workable = machineWorkable(m, c.iso).workable && c.iso <= today;
                  const cellCls = cn("relative h-11 min-w-11 border-l p-0 text-center", c.weekend && "bg-muted/40", c.iso > today && "bg-muted/20");
                  const mark = entry?.hours != null ? <span className="text-xs font-bold">{hoursText(entry.hours)}</span> : "✓";

                  if (canWrite && (on || workable)) {
                    return (
                      <td key={c.iso} className={cellCls}>
                        <button
                          type="button"
                          aria-pressed={on}
                          aria-label={`${m.name}, ${formatDate(c.iso)}: ${on ? "geldi" : "gelmedi"}. Değiştirmek için dokunun`}
                          disabled={busy.has(key)}
                          onClick={() => apply(m, c.iso, !on)}
                          className={cn(
                            "flex h-11 w-full min-w-11 items-center justify-center outline-none focus-visible:ring-2 focus-visible:ring-ring",
                            on ? "font-bold text-emerald-600 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-950/40" : "hover:bg-emerald-50 dark:hover:bg-emerald-950/30",
                            busy.has(key) && "opacity-50",
                          )}
                        >
                          {on ? mark : ""}
                        </button>
                        {entry?.note && <span title={entry.note} className="pointer-events-none absolute right-1 top-0.5 text-[10px] leading-none text-orange-500">●</span>}
                      </td>
                    );
                  }
                  return (
                    <td key={c.iso} title={entry?.note ? `Not: ${entry.note}` : on ? "Geldi" : !workable && c.iso <= today ? "Çalışma dışı" : undefined} className={cellCls}>
                      <span className="flex h-11 min-w-11 items-center justify-center">
                        {on ? <span className="font-bold text-emerald-600 dark:text-emerald-400">{mark}</span> : c.iso <= today && !workable ? <span className="text-muted-foreground/50">–</span> : null}
                      </span>
                      {entry?.note && <span className="pointer-events-none absolute right-1 top-0.5 text-[10px] leading-none text-orange-500">●</span>}
                    </td>
                  );
                })}
                <td className="border-l bg-card px-2 py-2 text-center font-semibold tabular-nums">{totalDays(m.id)}</td>
                <td className="sticky right-0 z-10 border-l bg-card px-2 py-2 text-center font-semibold tabular-nums">{totalHours(m.id) > 0 ? formatNumber(totalHours(m.id)) : "—"}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t bg-muted/50 font-semibold">
              <th scope="row" className="sticky left-0 z-10 border-r bg-muted px-3 py-2 text-left">
                Gelen
              </th>
              {dayTotals.map((n, i) => (
                <td key={cols[i].iso} className="h-11 min-w-11 border-l text-center tabular-nums text-muted-foreground">
                  {n > 0 ? n : ""}
                </td>
              ))}
              <td className="border-l bg-muted px-2 py-2 text-center tabular-nums">{rows.reduce((s, m) => s + totalDays(m.id), 0)}</td>
              <td className="sticky right-0 z-10 border-l bg-muted px-2 py-2 text-center tabular-nums">
                {rows.reduce((s, m) => s + totalHours(m.id), 0) > 0 ? formatNumber(rows.reduce((s, m) => s + totalHours(m.id), 0)) : "—"}
              </td>
            </tr>
          </tfoot>
        </table>
      </MatrixScroll>

      <div className="space-y-1 text-xs text-muted-foreground">
        <p className="flex flex-wrap gap-x-4 gap-y-1">
          <span><span className="font-bold text-emerald-600">✓</span> Geldi</span>
          <span><span className="font-bold text-emerald-600">8</span> Geldi, 8 saat çalıştı</span>
          <span>– Çalışma dışı</span>
          <span><span className="text-orange-500">●</span> Notu var</span>
        </p>
        <p>{canWrite ? "Bir güne dokunarak işareti ekleyebilir veya kaldırabilirsiniz. Saat ve not eklemek için günlük ekranı kullanın (gün numarasına dokunun)." : "Bu ekranı yalnızca görüntüleyebilirsiniz."}</p>
      </div>
    </div>
  );
}
