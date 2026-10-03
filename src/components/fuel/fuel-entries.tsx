"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Fuel, Loader2, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Field, FormError } from "@/components/auth/field";
import { DataRow } from "@/components/data-row";
import { deleteFuelEntry, saveFuelEntry } from "@/lib/fuel/actions";
import { FUEL_TYPES, FUEL_TYPE_LABELS, fuelEntrySchema, fuelTotal, num, type FuelType } from "@/lib/fuel/schemas";
import type { FuelRow } from "@/lib/fuel/queries";
import { formatCurrency, formatDate, formatNumber } from "@/lib/format";

const selectClass =
  "h-11 w-full rounded-lg border border-input bg-transparent px-2.5 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30 disabled:opacity-60";
const numText = (n: number) => String(n).replace(".", ",");

export type FuelMachine = { id: number; name: string; identifier: string | null };

/**
 * Yakıt kayıtları listesi ve ekleme/düzenleme penceresi (mobilde bottom-sheet, masaüstünde yan panel).
 * Listenin en sonunda dönemin toplam litre ve toplam tutarı gösterilir (liste sınırından bağımsız, sunucudan gelir).
 * Yazma yetkisi yoksa (viewer/admin) salt okunurdur.
 */
export function FuelEntries({
  siteId,
  canWrite,
  today,
  entries,
  hasMore,
  machines,
  defaultMachineId,
  suggestions,
  totals,
}: {
  siteId: number;
  canWrite: boolean;
  today: string;
  entries: FuelRow[];
  hasMore: boolean;
  machines: FuelMachine[];
  /** Araç süzgeci seçiliyse yeni kayıtta önceden seçilir. */
  defaultMachineId: number | null;
  suggestions: { people: string[]; stations: string[] };
  totals: { count: number; liters: number; total: number };
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<FuelRow | null>(null);
  const [side, setSide] = useState<"bottom" | "right">("bottom");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [machineId, setMachineId] = useState("");
  const [date, setDate] = useState(today);
  const [fuelType, setFuelType] = useState<FuelType>("motorin");
  const [liters, setLiters] = useState("");
  const [unitPrice, setUnitPrice] = useState("");
  const [fueledBy, setFueledBy] = useState("");
  const [station, setStation] = useState("");
  const [note, setNote] = useState("");

  function show(row: FuelRow | null) {
    setEditing(row);
    setMachineId(row ? String(row.machineId) : defaultMachineId !== null ? String(defaultMachineId) : machines.length === 1 ? String(machines[0].id) : "");
    setDate(row?.date ?? today);
    setFuelType(row?.fuelType ?? "motorin");
    setLiters(row ? numText(row.liters) : "");
    setUnitPrice(row ? numText(row.unitPrice) : "");
    setFueledBy(row?.fueledBy ?? "");
    setStation(row?.station ?? "");
    setNote(row?.note ?? "");
    setError(null);
    setSide(window.matchMedia("(min-width: 768px)").matches ? "right" : "bottom");
    setOpen(true);
  }

  async function onSave() {
    setError(null);
    const parsed = fuelEntrySchema.safeParse({ machineId, date, fuelType, liters, unitPrice, fueledBy, station, note });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? "Girilen bilgiler geçersiz.");
    setBusy(true);
    const res = await saveFuelEntry(siteId, editing?.id ?? null, parsed.data).catch(() => null);
    setBusy(false);
    if (!res) return setError("Kayıt eklenemedi, bağlantınızı kontrol edip tekrar deneyin.");
    if (!res.ok) return setError(res.error);
    setOpen(false);
    router.refresh();
  }

  async function onDelete() {
    if (!editing || !window.confirm(`${formatDate(editing.date)} tarihli ${editing.machineName} yakıt kaydı silinsin mi?`)) return;
    setBusy(true);
    const res = await deleteFuelEntry(siteId, editing.id).catch(() => null);
    setBusy(false);
    if (!res) return setError("Silinemedi, bağlantınızı kontrol edip tekrar deneyin.");
    if (!res.ok) return setError(res.error);
    setOpen(false);
    router.refresh();
  }

  const l = num(liters || "x");
  const p = num(unitPrice || "x");
  const preview = Number.isFinite(l) && Number.isFinite(p) ? fuelTotal(l, p) : null;

  if (machines.length === 0) {
    return (
      <div className="mx-auto flex max-w-sm flex-col items-center gap-3 py-12 text-center">
        <Fuel className="size-10 text-muted-foreground" aria-hidden />
        <h2 className="text-lg font-semibold">Önce bir araç ekleyin</h2>
        <p className="text-sm text-muted-foreground">Yakıt kaydı bir araca bağlanır. “İş Makineleri” sayfasındaki “Makineler” sekmesinden araç/makine ekleyin; ardından buradan yakıt girebilirsiniz.</p>
      </div>
    );
  }

  return (
    <section className="space-y-3" aria-label="Yakıt kayıtları">
      {canWrite && (
        <Button type="button" className="h-11" onClick={() => show(null)}>
          <Plus aria-hidden />
          Yakıt Ekle
        </Button>
      )}

      {entries.length === 0 ? (
        <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
          Bu dönemde yakıt kaydı yok.
          {canWrite && (
            <div className="mt-3">
              <Button type="button" className="h-11" onClick={() => show(null)}>
                <Plus aria-hidden />
                İlk kaydı ekle
              </Button>
            </div>
          )}
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card">
          <div className="divide-y">
            {entries.map((r) => (
              <DataRow
                key={r.id}
                onClick={canWrite ? () => show(r) : undefined}
                title={r.machineIdentifier ? `${r.machineName} · ${r.machineIdentifier}` : r.machineName}
                lines={[
                  [formatDate(r.date), FUEL_TYPE_LABELS[r.fuelType], r.fueledBy && `Alan: ${r.fueledBy}`].filter(Boolean).join(" · "),
                  [r.station, r.note].filter(Boolean).join(" · ") || null,
                ]}
                trailing={
                  <span className="block text-right">
                    <span className="block text-sm font-semibold tabular-nums text-orange-700 dark:text-orange-400">{formatCurrency(r.total)}</span>
                    <span className="block text-xs text-muted-foreground tabular-nums">
                      {formatNumber(r.liters)} L × {formatCurrency(r.unitPrice)}
                    </span>
                  </span>
                }
              />
            ))}
          </div>
          <div className="flex items-center justify-between gap-3 border-t bg-muted/60 px-4 py-3" data-testid="fuel-footer">
            <span className="text-sm font-semibold">
              Toplam <span className="font-normal text-muted-foreground">· {totals.count} alım · {formatNumber(totals.liters)} L</span>
            </span>
            <span className="text-base font-semibold tabular-nums text-orange-700 dark:text-orange-400" data-testid="fuel-grand-total">
              {formatCurrency(totals.total)}
            </span>
          </div>
        </div>
      )}
      {hasMore && <p className="text-xs text-muted-foreground">Dönemde çok kayıt var; en yeni 300 tanesi gösteriliyor. Toplam tüm kayıtları kapsar.</p>}

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side={side} showCloseButton={false} className="max-h-[92dvh] overflow-y-auto p-0">
          <SheetHeader className="flex-row items-start justify-between gap-2 p-4 pb-0">
            <div className="space-y-1">
              <SheetTitle>{editing ? "Yakıt Kaydını Düzenle" : "Yakıt Ekle"}</SheetTitle>
              <SheetDescription>Hangi araç, kim aldı, kaç litre; toplam tutar otomatik hesaplanır.</SheetDescription>
            </div>
            <Button type="button" variant="ghost" className="size-11 shrink-0" aria-label="Kapat" onClick={() => setOpen(false)}>
              <X aria-hidden />
            </Button>
          </SheetHeader>
          <div className="space-y-4 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <FormError message={open ? error : null} />
            <Field id="fu-machine" label="Araç">
              <select id="fu-machine" className={selectClass} value={machineId} onChange={(e) => setMachineId(e.target.value)}>
                <option value="">— Araç seçin —</option>
                {machines.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.identifier ? `${m.name} · ${m.identifier}` : m.name}
                  </option>
                ))}
              </select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field id="fu-date" label="Tarih">
                <Input id="fu-date" type="date" max={today} className="h-11" value={date} onChange={(e) => setDate(e.target.value)} />
              </Field>
              <Field id="fu-type" label="Yakıt türü">
                <select id="fu-type" className={selectClass} value={fuelType} onChange={(e) => setFuelType(e.target.value as FuelType)}>
                  {FUEL_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {FUEL_TYPE_LABELS[t]}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field id="fu-liters" label="Litre">
                <Input id="fu-liters" inputMode="decimal" autoComplete="off" className="h-11" value={liters} onChange={(e) => setLiters(e.target.value)} />
              </Field>
              <Field id="fu-price" label="Litre fiyatı (₺)">
                <Input id="fu-price" inputMode="decimal" autoComplete="off" className="h-11" value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} />
              </Field>
            </div>
            <p className="flex items-center justify-between rounded-lg bg-muted px-3 py-3" aria-live="polite">
              <span className="text-sm text-muted-foreground">Toplam tutar (litre × litre fiyatı)</span>
              <span className="text-lg font-semibold tabular-nums" data-testid="fuel-preview">{preview === null ? "—" : formatCurrency(preview)}</span>
            </p>
            <Field id="fu-by" label="Yakıtı kim aldı (opsiyonel)">
              <Input id="fu-by" list="dl-fu-people" autoComplete="off" className="h-11" value={fueledBy} onChange={(e) => setFueledBy(e.target.value)} />
            </Field>
            <Field id="fu-station" label="İstasyon / firma (opsiyonel)">
              <Input id="fu-station" list="dl-fu-stations" autoComplete="off" className="h-11" value={station} onChange={(e) => setStation(e.target.value)} />
            </Field>
            <Field id="fu-note" label="Not (opsiyonel)">
              <Input id="fu-note" autoComplete="off" className="h-11" value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
            <datalist id="dl-fu-people">{suggestions.people.map((v) => <option key={v} value={v} />)}</datalist>
            <datalist id="dl-fu-stations">{suggestions.stations.map((v) => <option key={v} value={v} />)}</datalist>
            <div className="flex gap-2 pt-1">
              {editing && (
                <Button type="button" variant="destructive" className="h-12 shrink-0" onClick={onDelete} disabled={busy} aria-label="Kaydı sil">
                  <Trash2 aria-hidden />
                  Sil
                </Button>
              )}
              <Button type="button" className="h-12 flex-1 text-base" onClick={onSave} disabled={busy}>
                {busy ? <Loader2 className="animate-spin" aria-hidden /> : <Check aria-hidden />}
                {editing ? "Değişiklikleri Kaydet" : "Kaydet"}
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </section>
  );
}
