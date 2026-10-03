"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Plus, Trash2, Truck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Field, FormError } from "@/components/auth/field";
import { DataRow } from "@/components/data-row";
import { deleteMachine, saveMachine } from "@/lib/machines/actions";
import { machineSubtitle } from "@/lib/machines/labels";
import {
  MACHINE_STATUSES,
  MACHINE_STATUS_LABELS,
  MACHINE_TYPES,
  MACHINE_TYPE_LABELS,
  OWNERSHIPS,
  OWNERSHIP_LABELS,
  RATE_UNITS,
  RATE_UNIT_LABELS,
  machineSchema,
  type MachineStatus,
  type MachineType,
  type Ownership,
  type RateUnit,
} from "@/lib/machines/schemas";
import type { MachineRow } from "@/lib/machines/queries";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

const selectClass =
  "h-11 w-full rounded-lg border border-input bg-transparent px-2.5 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30";

const rateText = (n: number) => String(n).replace(".", ",");

/**
 * Makine kartları: liste + ekleme/düzenleme penceresi (mobilde bottom-sheet, masaüstünde yan panel).
 * Yazma yetkisi yoksa (admin/viewer) salt okunurdur.
 */
export function MachineRegistry({ siteId, machines, canWrite }: { siteId: number; machines: MachineRow[]; canWrite: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<MachineRow | null>(null);
  const [side, setSide] = useState<"bottom" | "right">("bottom");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [name, setName] = useState("");
  const [type, setType] = useState<MachineType | "">("");
  const [identifier, setIdentifier] = useState("");
  const [ownership, setOwnership] = useState<Ownership>("own");
  const [supplier, setSupplier] = useState("");
  const [rateUnit, setRateUnit] = useState<RateUnit | "">("");
  const [rate, setRate] = useState("");
  const [status, setStatus] = useState<MachineStatus>("active");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  function show(m: MachineRow | null) {
    setEditing(m);
    setName(m?.name ?? "");
    setType(m?.machine_type ?? "");
    setIdentifier(m?.identifier ?? "");
    setOwnership(m?.ownership ?? "own");
    setSupplier(m?.supplier ?? "");
    setRateUnit(m?.rate_unit ?? "");
    setRate(m?.rental_rate != null ? rateText(m.rental_rate) : "");
    setStatus(m?.status ?? "active");
    setStartDate(m?.start_date ?? "");
    setEndDate(m?.end_date ?? "");
    setError(null);
    setSide(window.matchMedia("(min-width: 768px)").matches ? "right" : "bottom");
    setOpen(true);
  }

  async function onSave() {
    setError(null);
    const parsed = machineSchema.safeParse({ name, machineType: type, identifier, ownership, supplier, rateUnit, rentalRate: rate, status, startDate, endDate });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? "Girilen bilgiler geçersiz.");
    setBusy(true);
    const res = await saveMachine(siteId, editing?.id ?? null, parsed.data).catch(() => null);
    setBusy(false);
    if (!res) return setError("Makine kaydedilemedi, bağlantınızı kontrol edip tekrar deneyin.");
    if (!res.ok) return setError(res.error);
    setOpen(false);
    router.refresh();
  }

  async function onDelete() {
    if (!editing || !window.confirm(`“${editing.name}” silinsin mi? Bu makinenin puantaj kayıtları da silinir.`)) return;
    setBusy(true);
    const res = await deleteMachine(siteId, editing.id).catch(() => null);
    setBusy(false);
    if (!res) return setError("Silinemedi, bağlantınızı kontrol edip tekrar deneyin.");
    if (!res.ok) return setError(res.error);
    setOpen(false);
    router.refresh();
  }

  return (
    <section className="space-y-3" aria-label="Makineler">
      {canWrite && (
        <Button type="button" className="h-11" onClick={() => show(null)}>
          <Plus aria-hidden />
          Makine Ekle
        </Button>
      )}

      {machines.length === 0 ? (
        <div className="mx-auto flex max-w-sm flex-col items-center gap-3 rounded-xl border border-dashed px-4 py-10 text-center">
          <Truck className="size-9 text-muted-foreground" aria-hidden />
          <p className="font-medium">Henüz makine eklenmedi</p>
          <p className="text-sm text-muted-foreground">{canWrite ? "Kepçe, ekskavatör, kamyon gibi makinelerinizi ekleyin; sonra günlük puantajını tutabilirsiniz." : "Makine eklendikçe burada listelenir."}</p>
          {canWrite && (
            <Button type="button" className="h-11" onClick={() => show(null)}>
              <Plus aria-hidden />
              İlk makineyi ekle
            </Button>
          )}
        </div>
      ) : (
        <div className="divide-y rounded-xl border bg-card">
          {machines.map((m) => (
            <DataRow
              key={m.id}
              onClick={canWrite ? () => show(m) : undefined}
              title={m.name}
              badge={<span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">{MACHINE_TYPE_LABELS[m.machine_type]}</span>}
              lines={[
                [m.identifier, machineSubtitle(m)].filter(Boolean).join(" · "),
                [m.status !== "active" && MACHINE_STATUS_LABELS[m.status], m.start_date && `Başlangıç ${formatDate(m.start_date)}`, m.end_date && `Ayrılış ${formatDate(m.end_date)}`].filter(Boolean).join(" · "),
              ]}
            />
          ))}
        </div>
      )}

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side={side} showCloseButton={false} className="max-h-[92dvh] overflow-y-auto p-0">
          <SheetHeader className="flex-row items-start justify-between gap-2 p-4 pb-0">
            <div className="space-y-1">
              <SheetTitle>{editing ? "Makineyi Düzenle" : "Makine Ekle"}</SheetTitle>
              <SheetDescription>Makine kartı; günlük puantaj ve kira ödemesi bu karta bağlanır.</SheetDescription>
            </div>
            <Button type="button" variant="ghost" className="size-11 shrink-0" aria-label="Kapat" onClick={() => setOpen(false)}>
              <X aria-hidden />
            </Button>
          </SheetHeader>
          <div className="space-y-4 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <FormError message={open ? error : null} />
            <Field id="mc-name" label="Makine adı">
              <Input id="mc-name" autoComplete="off" placeholder="Ör. CAT 320 Ekskavatör" className="h-11" value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field id="mc-type" label="Türü">
                <select id="mc-type" className={selectClass} value={type} onChange={(e) => setType(e.target.value as MachineType | "")}>
                  <option value="">— Seçin —</option>
                  {MACHINE_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {MACHINE_TYPE_LABELS[t]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field id="mc-ident" label="Plaka / seri no">
                <Input id="mc-ident" autoComplete="off" className="h-11" value={identifier} onChange={(e) => setIdentifier(e.target.value)} />
              </Field>
            </div>

            <div className="space-y-1.5">
              <span id="mc-own" className="text-sm font-medium">
                Sahiplik
              </span>
              <div role="radiogroup" aria-labelledby="mc-own" className="grid grid-cols-2 gap-2">
                {OWNERSHIPS.map((o) => (
                  <button
                    key={o}
                    type="button"
                    role="radio"
                    aria-checked={ownership === o}
                    onClick={() => setOwnership(o)}
                    className={cn("flex min-h-12 items-center justify-center rounded-lg border text-sm font-medium", ownership === o && "border-primary bg-primary text-primary-foreground")}
                  >
                    {OWNERSHIP_LABELS[o]}
                  </button>
                ))}
              </div>
            </div>

            {ownership === "rented" && (
              <div className="space-y-4 rounded-lg border border-dashed p-3">
                <Field id="mc-supplier" label="Kiralayan firma (opsiyonel)">
                  <Input id="mc-supplier" autoComplete="off" className="h-11" value={supplier} onChange={(e) => setSupplier(e.target.value)} />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field id="mc-unit" label="Kira birimi">
                    <select id="mc-unit" className={selectClass} value={rateUnit} onChange={(e) => setRateUnit(e.target.value as RateUnit | "")}>
                      <option value="">— Seçin —</option>
                      {RATE_UNITS.map((u) => (
                        <option key={u} value={u}>
                          {RATE_UNIT_LABELS[u]}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field id="mc-rate" label="Birim kira (₺)">
                    <Input id="mc-rate" inputMode="decimal" autoComplete="off" className="h-11" value={rate} onChange={(e) => setRate(e.target.value)} />
                  </Field>
                </div>
                <p className="text-xs text-muted-foreground">Kira ödemesi için birim ve tutar girilmelidir; “Kira Ödemeleri” sekmesi bunu kullanır.</p>
              </div>
            )}

            <Field id="mc-status" label="Durum">
              <select id="mc-status" className={selectClass} value={status} onChange={(e) => setStatus(e.target.value as MachineStatus)}>
                {MACHINE_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {MACHINE_STATUS_LABELS[s]}
                  </option>
                ))}
              </select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field id="mc-start" label="Şantiyeye geliş (opsiyonel)">
                <Input id="mc-start" type="date" className="h-11" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              </Field>
              <Field id="mc-end" label="Ayrılış (opsiyonel)">
                <Input id="mc-end" type="date" className="h-11" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
              </Field>
            </div>

            <div className="flex gap-2 pt-1">
              {editing && (
                <Button type="button" variant="destructive" className="h-12 shrink-0" onClick={onDelete} disabled={busy} aria-label="Makineyi sil">
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
