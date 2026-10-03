"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Truck, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormError } from "@/components/auth/field";
import { machineSubtitle } from "@/lib/machines/labels";
import { saveMachineDay, setMachineAttendance } from "@/lib/machines/actions";
import { hoursConfirmText, markConfirmText, unmarkConfirmText, type PaidInfo } from "@/lib/machines/unmark";
import { MACHINE_TYPE_LABELS } from "@/lib/machines/schemas";
import type { DayEntry, MachineRow } from "@/lib/machines/queries";
import { cn } from "@/lib/utils";

export type DailyMachine = MachineRow & { warning?: string };
export type ExcludedMachine = { id: number; name: string; reason: string };

const hoursText = (h: number | null | undefined) => (h == null ? "" : String(h).replace(".", ","));

/**
 * Günlük Gelenler (iş makineleri): her makine için "Geldi" düğmesi; işaretlenen makineye isteğe bağlı çalışma saati ve not girilir.
 * Her dokunuş anında kaydolur (iyimser güncelleme; hata olursa geri alınır). Yazma yetkisi yoksa (admin/viewer) salt okunurdur.
 */
export function MachineDaily({
  siteId,
  date,
  machines,
  excluded,
  initial,
  paid,
  canWrite,
}: {
  siteId: number;
  date: string;
  machines: DailyMachine[];
  excluded: ExcludedMachine[];
  initial: Record<number, DayEntry>;
  /** Bu ay makine başına yapılmış kira ödemeleri (işaret kaldırma onayı için) */
  paid: Record<number, PaidInfo>;
  canWrite: boolean;
}) {
  const router = useRouter();
  const [entries, setEntries] = useState<Record<number, DayEntry | undefined>>(initial);
  const [hours, setHours] = useState<Record<number, string>>(() => Object.fromEntries(Object.entries(initial).map(([id, e]) => [id, hoursText(e.hours)])));
  const [notes, setNotes] = useState<Record<number, string>>(() => Object.fromEntries(Object.entries(initial).map(([id, e]) => [id, e.note ?? ""])));
  const [busy, setBusy] = useState<Set<number>>(new Set());
  const [saved, setSaved] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Kaldırılan işaret 10 sn içinde saat ve notuyla birlikte geri getirilebilir
  const [undo, setUndo] = useState<{ id: number; name: string; hours: string; note: string } | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const presentCount = machines.filter((m) => entries[m.id]).length;

  function flashSaved(id: number) {
    setSaved(id);
    if (savedTimer.current) clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => setSaved(null), 1500);
  }

  async function toggle(m: DailyMachine) {
    if (busy.has(m.id)) return;
    setError(null);
    const on = !!entries[m.id];
    // Yanlışlıkla dokunmaya karşı: saat/not ya da kira ödemesi varsa işareti kaldırmadan önce sor.
    const prevHours = (hours[m.id] ?? "").trim();
    const prevNote = (notes[m.id] ?? "").trim();
    if (on) {
      const text = unmarkConfirmText(m.name, date, { hours: prevHours === "" ? null : Number(prevHours.replace(",", ".")), note: prevNote || null }, paid[m.id]);
      if (text && !window.confirm(text)) return;
    } else {
      // Ay tam ödenmişse yeni gün ödemeyi de artırır: önce sor
      const text = markConfirmText(m.name, date, paid[m.id]);
      if (text && !window.confirm(text)) return;
    }
    setEntries((p) => ({ ...p, [m.id]: on ? undefined : { hours: null, note: null } }));
    setBusy((b) => new Set(b).add(m.id));
    const res = await setMachineAttendance({ siteId, date, add: on ? [] : [m.id], remove: on ? [m.id] : [] }).catch(() => null);
    setBusy((b) => {
      const n = new Set(b);
      n.delete(m.id);
      return n;
    });
    if (!res || !res.ok) {
      setEntries((p) => ({ ...p, [m.id]: on ? { hours: null, note: null } : undefined })); // geri al
      setError(res && !res.ok ? res.error : "Değişiklik kaydedilemedi, bağlantınızı kontrol edip tekrar deneyin.");
      return;
    }
    if (on) {
      setHours((h) => ({ ...h, [m.id]: "" }));
      setNotes((n) => ({ ...n, [m.id]: "" }));
      setUndo({ id: m.id, name: m.name, hours: prevHours, note: prevNote });
      if (undoTimer.current) clearTimeout(undoTimer.current);
      undoTimer.current = setTimeout(() => setUndo(null), 10_000);
    }
    router.refresh();
  }

  /** Kaldırılan işareti saat ve notuyla birlikte geri getirir. */
  async function restore() {
    if (!undo) return;
    const u = undo;
    setError(null);
    setBusy((b) => new Set(b).add(u.id));
    const res = await setMachineAttendance({ siteId, date, add: [u.id], remove: [] }).catch(() => null);
    let ok = !!res && res.ok;
    if (ok && (u.hours !== "" || u.note !== "")) {
      const r2 = await saveMachineDay(siteId, u.id, date, { hours: u.hours, note: u.note }).catch(() => null);
      ok = !!r2 && r2.ok;
    }
    setBusy((b) => {
      const n = new Set(b);
      n.delete(u.id);
      return n;
    });
    if (!ok) return setError("Geri alınamadı, bağlantınızı kontrol edip tekrar deneyin.");
    setEntries((p) => ({ ...p, [u.id]: { hours: u.hours === "" ? null : Number(u.hours.replace(",", ".")), note: u.note || null } }));
    setHours((h) => ({ ...h, [u.id]: u.hours }));
    setNotes((n) => ({ ...n, [u.id]: u.note }));
    setUndo(null);
    router.refresh();
  }

  async function persistDay(m: DailyMachine) {
    const h = (hours[m.id] ?? "").trim();
    const n = (notes[m.id] ?? "").trim();
    const cur = entries[m.id];
    // Değişmediyse sunucuya gitme
    if (cur && hoursText(cur.hours) === h && (cur.note ?? "") === n) return;
    // Saatlik kirada, ay tam ödenmişse saat değişimi ödemeyi de değiştirir: önce sor, vazgeçilirse eski değer geri yazılır
    const newHours = h === "" ? null : Number(h.replace(",", "."));
    const confirmText = cur ? hoursConfirmText(m.name, date, cur.hours, newHours, paid[m.id]) : null;
    if (confirmText && !window.confirm(confirmText)) {
      setHours((x) => ({ ...x, [m.id]: hoursText(cur?.hours) }));
      setNotes((x) => ({ ...x, [m.id]: cur?.note ?? "" }));
      return;
    }
    setError(null);
    const res = await saveMachineDay(siteId, m.id, date, { hours: h, note: n }).catch(() => null);
    if (!res || !res.ok) return setError(res && !res.ok ? res.error : "Saat/not kaydedilemedi, bağlantınızı kontrol edip tekrar deneyin.");
    setEntries((p) => ({ ...p, [m.id]: { hours: h === "" ? null : Number(h.replace(",", ".")), note: n || null } }));
    flashSaved(m.id);
    router.refresh();
  }

  if (machines.length === 0 && excluded.length === 0) {
    return (
      <div className="mx-auto flex max-w-sm flex-col items-center gap-3 py-12 text-center">
        <Truck className="size-10 text-muted-foreground" aria-hidden />
        <h2 className="text-lg font-semibold">Henüz makine yok</h2>
        <p className="text-sm text-muted-foreground">Önce “Makineler” sekmesinden makinelerinizi ekleyin; sonra burada günlük puantajını tutarsınız.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <FormError message={error} />
      <div aria-live="polite">
        {undo && (
          <div className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm">
            <span className="min-w-0 flex-1">
              <span className="font-medium">{undo.name}</span> işareti kaldırıldı
            </span>
            <Button type="button" variant="ghost" className="h-11 shrink-0" onClick={restore}>
              <Undo2 aria-hidden />
              Geri al
            </Button>
          </div>
        )}
      </div>
      <p className="text-sm text-muted-foreground" aria-live="polite">
        <span className="font-semibold text-foreground">{presentCount}</span> / {machines.length} makine geldi
      </p>

      <ul className="divide-y rounded-xl border bg-card">
        {machines.map((m) => {
          const on = !!entries[m.id];
          return (
            <li key={m.id} className="space-y-2 px-3 py-3">
              <div className="flex items-center gap-3">
                {canWrite ? (
                  <button
                    type="button"
                    aria-pressed={on}
                    aria-label={`${m.name}: ${on ? "geldi" : "gelmedi"}. Değiştirmek için dokunun`}
                    disabled={busy.has(m.id)}
                    onClick={() => toggle(m)}
                    className={cn(
                      "flex size-12 shrink-0 items-center justify-center rounded-lg border-2 text-lg font-bold outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      on ? "border-emerald-600 bg-emerald-600 text-white" : "border-input hover:bg-muted",
                      busy.has(m.id) && "opacity-50",
                    )}
                  >
                    {busy.has(m.id) ? <Loader2 className="size-5 animate-spin" aria-hidden /> : on ? "✓" : ""}
                  </button>
                ) : (
                  <span aria-label={on ? "Geldi" : "Gelmedi"} className={cn("flex size-12 shrink-0 items-center justify-center rounded-lg border-2 text-lg font-bold", on ? "border-emerald-600 bg-emerald-600 text-white" : "border-input")}>
                    {on ? "✓" : ""}
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">{m.name}</span>
                    <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">{MACHINE_TYPE_LABELS[m.machine_type]}</span>
                  </p>
                  <p className="truncate text-xs text-muted-foreground">{[m.identifier, machineSubtitle(m)].filter(Boolean).join(" · ")}</p>
                  {m.warning && <p className="text-xs text-amber-700 dark:text-amber-400">{m.warning}</p>}
                </div>
                {saved === m.id && (
                  <span className="flex shrink-0 items-center gap-1 text-xs text-emerald-700 dark:text-emerald-400" role="status">
                    <Check className="size-3.5" aria-hidden />
                    Kaydedildi
                  </span>
                )}
              </div>

              {on && (
                <div className="grid grid-cols-[6rem_1fr] gap-2 pl-[3.75rem]">
                  {canWrite ? (
                    <>
                      <Input
                        aria-label={`${m.name} çalışma saati`}
                        inputMode="decimal"
                        placeholder="Saat"
                        autoComplete="off"
                        className="h-11"
                        value={hours[m.id] ?? ""}
                        onChange={(e) => setHours((h) => ({ ...h, [m.id]: e.target.value }))}
                        onBlur={() => persistDay(m)}
                        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                      />
                      <Input
                        aria-label={`${m.name} notu`}
                        placeholder="Not (ör. temel kazısı)"
                        autoComplete="off"
                        className="h-11"
                        value={notes[m.id] ?? ""}
                        onChange={(e) => setNotes((n) => ({ ...n, [m.id]: e.target.value }))}
                        onBlur={() => persistDay(m)}
                        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                      />
                    </>
                  ) : (
                    <p className="col-span-2 text-xs text-muted-foreground">
                      {entries[m.id]?.hours != null ? `${hoursText(entries[m.id]?.hours)} saat` : "Saat girilmedi"}
                      {entries[m.id]?.note ? ` · ${entries[m.id]?.note}` : ""}
                    </p>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {excluded.length > 0 && (
        <details className="rounded-xl border bg-card">
          <summary className="flex min-h-11 cursor-pointer items-center px-4 text-sm text-muted-foreground">Bu tarihte listede olmayanlar ({excluded.length})</summary>
          <ul className="divide-y border-t">
            {excluded.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
                <span className="truncate">{m.name}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{m.reason}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
