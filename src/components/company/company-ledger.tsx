"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Field, FormError } from "@/components/auth/field";
import { DataRow } from "@/components/data-row";
import { deleteCompanyEntry, saveCompanyEntry } from "@/lib/company/actions";
import { COMPANY_ENTRY_TYPES, COMPANY_ENTRY_TYPE_LABELS, companyEntrySchema, type CompanyEntryType } from "@/lib/company/schemas";
import { formatCurrency, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

export type LedgerRow = { id: number; type: CompanyEntryType; date: string; description: string; amount: number };

const amountText = (n: number) => String(n).replace(".", ",");

/**
 * Şirket kasası listesi + ekleme/düzenleme penceresi (mobilde bottom-sheet, masaüstünde yan panel).
 * `canWrite` false ise (admin) liste salt okunurdur.
 */
export function CompanyLedger({ rows, hasMore, canWrite, today }: { rows: LedgerRow[]; hasMore: boolean; canWrite: boolean; today: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<LedgerRow | null>(null);
  const [type, setType] = useState<CompanyEntryType>("expense");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(today);
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [side, setSide] = useState<"bottom" | "right">("bottom");

  function show(row: LedgerRow | null) {
    setEditing(row);
    setType(row?.type ?? "expense");
    setAmount(row ? amountText(row.amount) : "");
    setDate(row?.date ?? today);
    setDescription(row?.description ?? "");
    setError(null);
    setSide(window.matchMedia("(min-width: 768px)").matches ? "right" : "bottom");
    setOpen(true);
  }

  async function onSave() {
    setError(null);
    const parsed = companyEntrySchema.safeParse({ type, amount, date, description });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? "Girilen bilgiler geçersiz.");
    setBusy(true);
    const res = await saveCompanyEntry(editing?.id ?? null, parsed.data).catch(() => null);
    setBusy(false);
    if (!res) return setError("Kayıt eklenemedi, bağlantınızı kontrol edip tekrar deneyin.");
    if (!res.ok) return setError(res.error);
    setOpen(false);
    router.refresh();
  }

  async function onDelete() {
    if (!editing || !window.confirm("Bu kayıt silinsin mi?")) return;
    setBusy(true);
    const res = await deleteCompanyEntry(editing.id).catch(() => null);
    setBusy(false);
    if (!res) return setError("Silinemedi, bağlantınızı kontrol edip tekrar deneyin.");
    if (!res.ok) return setError(res.error);
    setOpen(false);
    router.refresh();
  }

  return (
    <section className="space-y-3" aria-label="Şirket kasası hareketleri">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">Hareketler</h2>
        {canWrite && (
          <Button type="button" className="h-11" onClick={() => show(null)}>
            <Plus aria-hidden />
            Gelir / Gider Ekle
          </Button>
        )}
      </div>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
          Bu dönemde şirket kasasında kayıt yok.
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
        <div className="divide-y rounded-xl border bg-card">
          {rows.map((r) => (
            <DataRow
              key={r.id}
              onClick={canWrite ? () => show(r) : undefined}
              title={r.description}
              lines={[formatDate(r.date)]}
              trailing={
                <span className={cn("text-sm font-semibold tabular-nums", r.type === "income" ? "text-emerald-700 dark:text-emerald-400" : "text-orange-700 dark:text-orange-400")}>
                  {r.type === "income" ? "+" : "−"}
                  {formatCurrency(r.amount)}
                </span>
              }
            />
          ))}
        </div>
      )}
      {hasMore && <p className="text-xs text-muted-foreground">Dönemde çok kayıt var; en yeni 500 tanesi gösteriliyor. Toplamlar tüm kayıtları kapsar.</p>}

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side={side} showCloseButton={false} className="max-h-[92dvh] overflow-y-auto p-0">
          <SheetHeader className="flex-row items-start justify-between gap-2 p-4 pb-0">
            <div className="space-y-1">
              <SheetTitle>{editing ? "Kaydı Düzenle" : "Gelir / Gider Ekle"}</SheetTitle>
              <SheetDescription>Şirket kasasına kaydedilir; şantiye kasasından ayrıdır.</SheetDescription>
            </div>
            <Button type="button" variant="ghost" className="size-11 shrink-0" aria-label="Kapat" onClick={() => setOpen(false)}>
              <X aria-hidden />
            </Button>
          </SheetHeader>
          <div className="space-y-4 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <FormError message={error} />
            <div className="space-y-1.5">
              <span id="ce-type" className="text-sm font-medium">
                Tür
              </span>
              <div role="radiogroup" aria-labelledby="ce-type" className="grid grid-cols-2 gap-2">
                {COMPANY_ENTRY_TYPES.map((t) => (
                  <button
                    key={t}
                    type="button"
                    role="radio"
                    aria-checked={type === t}
                    onClick={() => setType(t)}
                    className={cn(
                      "flex min-h-12 items-center justify-center rounded-lg border text-sm font-medium",
                      type === t && (t === "income" ? "border-emerald-600 bg-emerald-600 text-white" : "border-orange-600 bg-orange-600 text-white"),
                    )}
                  >
                    {COMPANY_ENTRY_TYPE_LABELS[t]}
                  </button>
                ))}
              </div>
            </div>
            <Field id="ce-amount" label="Tutar (₺)">
              <Input id="ce-amount" inputMode="decimal" autoComplete="off" className="h-11 text-lg font-semibold" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </Field>
            <Field id="ce-date" label="Tarih">
              <Input id="ce-date" type="date" className="h-11" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Field id="ce-desc" label="Açıklama">
              <Input id="ce-desc" autoComplete="off" placeholder="Ne için / kimden" className="h-11" value={description} onChange={(e) => setDescription(e.target.value)} />
            </Field>
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
