"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Field, FormError } from "@/components/auth/field";
import { DataRow } from "@/components/data-row";
import { deleteMaterialEntry, saveMaterialEntry } from "@/lib/materials/actions";
import { lineTotal, materialEntrySchema, num } from "@/lib/materials/schemas";
import type { EntryRow, Suggestions } from "@/lib/materials/queries";
import { COMMON_UNITS } from "@/lib/goods/schemas";
import { formatCurrency, formatDate, formatNumber } from "@/lib/format";

const numText = (n: number) => String(n).replace(".", ",");

/**
 * Malzeme girişleri listesi ve ekleme/düzenleme penceresi (mobilde bottom-sheet, masaüstünde yan panel).
 * Kullanım yeri ilk girişte boş bırakılabilir; satıra dokunup sonradan eklenir. Yazma yetkisi yoksa salt okunurdur.
 */
export function MaterialEntries({
  siteId,
  canWrite,
  today,
  entries,
  hasMore,
  suggestions,
  showEnteredBy,
}: {
  siteId: number;
  canWrite: boolean;
  today: string;
  entries: EntryRow[];
  hasMore: boolean;
  suggestions: Suggestions;
  /** Yalnızca admin için: kayıtları kimin girdiğini göster (ortaklar zaten yalnızca kendi kayıtlarını görür). */
  showEnteredBy?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<EntryRow | null>(null);
  const [side, setSide] = useState<"bottom" | "right">("bottom");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [date, setDate] = useState(today);
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("");
  const [quantity, setQuantity] = useState("");
  const [unitPrice, setUnitPrice] = useState("");
  const [supplier, setSupplier] = useState("");
  const [usedFor, setUsedFor] = useState("");
  const [note, setNote] = useState("");

  function show(row: EntryRow | null) {
    setEditing(row);
    setDate(row?.date ?? today);
    setName(row?.name ?? "");
    setUnit(row?.unit ?? "");
    setQuantity(row ? numText(row.quantity) : "");
    setUnitPrice(row ? numText(row.unitPrice) : "");
    setSupplier(row?.supplier ?? "");
    setUsedFor(row?.usedFor ?? "");
    setNote(row?.note ?? "");
    setError(null);
    setSide(window.matchMedia("(min-width: 768px)").matches ? "right" : "bottom");
    setOpen(true);
  }

  async function onSave() {
    setError(null);
    const parsed = materialEntrySchema.safeParse({ date, name, unit, quantity, unitPrice, supplier, usedFor, note });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? "Girilen bilgiler geçersiz.");
    setBusy(true);
    const res = await saveMaterialEntry(siteId, editing?.id ?? null, parsed.data).catch(() => null);
    setBusy(false);
    if (!res) return setError("Kayıt eklenemedi, bağlantınızı kontrol edip tekrar deneyin.");
    if (!res.ok) return setError(res.error);
    setOpen(false);
    router.refresh();
  }

  async function onDelete() {
    if (!editing || !window.confirm(`“${editing.name}” girişi silinsin mi?`)) return;
    setBusy(true);
    const res = await deleteMaterialEntry(siteId, editing.id).catch(() => null);
    setBusy(false);
    if (!res) return setError("Silinemedi, bağlantınızı kontrol edip tekrar deneyin.");
    if (!res.ok) return setError(res.error);
    setOpen(false);
    router.refresh();
  }

  const q = num(quantity || "x");
  const p = num(unitPrice || "x");
  const preview = Number.isFinite(q) && Number.isFinite(p) ? lineTotal(q, p) : null;
  const units = [...new Set([...suggestions.units, ...COMMON_UNITS])];

  return (
    <section className="space-y-3" aria-label="Malzeme girişleri">
      {canWrite && (
        <Button type="button" className="h-11" onClick={() => show(null)}>
          <Plus aria-hidden />
          Malzeme Girişi Ekle
        </Button>
      )}

      {entries.length === 0 ? (
        <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
          Bu dönemde malzeme girişi yok.
          {canWrite && (
            <div className="mt-3">
              <Button type="button" className="h-11" onClick={() => show(null)}>
                <Plus aria-hidden />
                İlk girişi ekle
              </Button>
            </div>
          )}
        </div>
      ) : (
        <div className="divide-y rounded-xl border bg-card">
          {entries.map((r) => (
            <DataRow
              key={r.id}
              onClick={canWrite ? () => show(r) : undefined}
              title={r.name}
              lines={[
                [formatDate(r.date), r.supplier && `Kimden: ${r.supplier}`, showEnteredBy && r.enteredBy && `Giren: ${r.enteredBy}`].filter(Boolean).join(" · "),
                r.usedFor ? `Kullanım: ${r.usedFor}` : <span key="u" className="italic">Kullanım yeri girilmedi</span>,
              ]}
              trailing={
                <span className="block text-right">
                  <span className="block text-sm font-semibold tabular-nums">{formatCurrency(r.total)}</span>
                  <span className="block text-xs text-muted-foreground tabular-nums">
                    {formatNumber(r.quantity)} {r.unit} × {formatCurrency(r.unitPrice)}
                  </span>
                </span>
              }
            />
          ))}
        </div>
      )}
      {hasMore && <p className="text-xs text-muted-foreground">Dönemde çok kayıt var; en yeni 300 tanesi gösteriliyor. Toplamlar tüm kayıtları kapsar.</p>}

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side={side} showCloseButton={false} className="max-h-[92dvh] overflow-y-auto p-0">
          <SheetHeader className="flex-row items-start justify-between gap-2 p-4 pb-0">
            <div className="space-y-1">
              <SheetTitle>{editing ? "Malzeme Girişini Düzenle" : "Malzeme Girişi Ekle"}</SheetTitle>
              <SheetDescription>Aldığınız malzeme ve fiyatı; maliyet otomatik hesaplanır.</SheetDescription>
            </div>
            <Button type="button" variant="ghost" className="size-11 shrink-0" aria-label="Kapat" onClick={() => setOpen(false)}>
              <X aria-hidden />
            </Button>
          </SheetHeader>
          <div className="space-y-4 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <FormError message={open ? error : null} />
            <Field id="me-date" label="Tarih">
              <Input id="me-date" type="date" className="h-11" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Field id="me-name" label="Malzeme">
              <Input id="me-name" list="dl-me-names" autoComplete="off" className="h-11" value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field id="me-qty" label="Miktar">
                <Input id="me-qty" inputMode="decimal" autoComplete="off" className="h-11" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
              </Field>
              <Field id="me-unit" label="Birim">
                <Input id="me-unit" list="dl-me-units" autoComplete="off" className="h-11" value={unit} onChange={(e) => setUnit(e.target.value)} />
              </Field>
            </div>
            <Field id="me-price" label="Birim fiyat (₺)">
              <Input id="me-price" inputMode="decimal" autoComplete="off" className="h-11" value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} />
            </Field>
            <p className="flex items-center justify-between rounded-lg bg-muted px-3 py-3" aria-live="polite">
              <span className="text-sm text-muted-foreground">Maliyet (miktar × birim fiyat)</span>
              <span className="text-lg font-semibold tabular-nums">{preview === null ? "—" : formatCurrency(preview)}</span>
            </p>
            <Field id="me-supplier" label="Kimden alındı (opsiyonel)">
              <Input id="me-supplier" list="dl-me-suppliers" autoComplete="off" className="h-11" value={supplier} onChange={(e) => setSupplier(e.target.value)} />
            </Field>
            <Field id="me-used" label="Nerede / ne için kullanıldı (sonradan da eklenebilir)">
              <Input id="me-used" list="dl-me-usages" autoComplete="off" placeholder="Ör. B Blok temel betonu" className="h-11" value={usedFor} onChange={(e) => setUsedFor(e.target.value)} />
            </Field>
            <Field id="me-note" label="Not (opsiyonel)">
              <Input id="me-note" autoComplete="off" className="h-11" value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
            <datalist id="dl-me-names">{suggestions.names.map((v) => <option key={v} value={v} />)}</datalist>
            <datalist id="dl-me-units">{units.map((v) => <option key={v} value={v} />)}</datalist>
            <datalist id="dl-me-suppliers">{suggestions.suppliers.map((v) => <option key={v} value={v} />)}</datalist>
            <datalist id="dl-me-usages">{suggestions.usages.map((v) => <option key={v} value={v} />)}</datalist>
            <div className="flex gap-2 pt-1">
              {editing && (
                <Button type="button" variant="destructive" className="h-12 shrink-0" onClick={onDelete} disabled={busy} aria-label="Girişi sil">
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
