"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Banknote, Check, Loader2, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Field, FormError } from "@/components/auth/field";
import { deleteCashTransaction } from "@/lib/cash/actions";
import { getMonthWorkDays, savePersonPayment } from "@/lib/personnel/payment-actions";
import { monthLabel, personPaymentSchema, wageTotal } from "@/lib/personnel/payment-schemas";
import { PAYMENT_METHODS, PAYMENT_METHOD_LABELS } from "@/lib/parties/schemas";
import { formatCurrency, formatDate } from "@/lib/format";

const selectClass =
  "h-11 w-full rounded-lg border border-input bg-transparent px-2.5 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30";

export type PaymentRow = {
  id: number;
  amount: number;
  date: string;
  method: string | null;
  workDays: number | null;
  dailyRate: number | null;
  periodMonth: string | null; // "YYYY-MM"
  description: string;
};

const rateText = (n: number) => String(n).replace(".", ",");

/**
 * Personelin maaş ödemeleri: gün × günlük tutar. Her ödeme kasada bir gider (kategori "İşçilik") olarak görünür;
 * bu yüzden Genel Kasa'da tarih/kategori süzgeçleriyle ve raporlarda zaten değerlendirilir.
 */
export function PersonPayments({
  siteId,
  personId,
  personName,
  dailyWage,
  payments,
  canWrite,
  today,
}: {
  siteId: number;
  personId: number;
  personName: string;
  dailyWage: number | null;
  payments: PaymentRow[];
  canWrite: boolean;
  today: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<PaymentRow | null>(null);
  const [month, setMonth] = useState(today.slice(0, 7));
  const [days, setDays] = useState("");
  const [rate, setRate] = useState("");
  const [date, setDate] = useState(today);
  const [method, setMethod] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [side, setSide] = useState<"bottom" | "right">("bottom");
  const daysTouched = useRef(false);

  const total = wageTotal(Number(days) || 0, Number(rate.replace(",", ".")) || 0);
  const grandTotal = payments.reduce((s, p) => s + p.amount, 0);

  function pickSide() {
    setSide(window.matchMedia("(min-width: 768px)").matches ? "right" : "bottom");
  }

  function openNew() {
    setEditing(null);
    setMonth(today.slice(0, 7));
    setDays("");
    setRate(dailyWage === null ? "" : rateText(dailyWage));
    setDate(today);
    setMethod("");
    setError(null);
    daysTouched.current = false;
    pickSide();
    setOpen(true);
  }

  function openEdit(p: PaymentRow) {
    if (!canWrite || p.workDays === null || p.dailyRate === null || !p.periodMonth) return;
    setEditing(p);
    setMonth(p.periodMonth);
    setDays(String(p.workDays));
    setRate(rateText(p.dailyRate));
    setDate(p.date);
    setMethod(p.method ?? "");
    setError(null);
    daysTouched.current = true;
    pickSide();
    setOpen(true);
  }

  // Yeni ödemede gün, seçilen ayın puantajından önerilir (elle değiştirildiyse dokunulmaz).
  useEffect(() => {
    if (!open || editing || !/^\d{4}-\d{2}$/.test(month)) return;
    let cancelled = false;
    getMonthWorkDays(siteId, personId, month)
      .then((res) => {
        if (cancelled || !res.ok || daysTouched.current) return;
        setDays(res.days > 0 ? String(res.days) : "");
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [open, editing, month, siteId, personId]);

  async function onSave() {
    setError(null);
    const parsed = personPaymentSchema.safeParse({ month, workDays: days, dailyRate: rate, date, paymentMethod: method });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? "Girilen bilgiler geçersiz.");
    setBusy(true);
    const res = await savePersonPayment(siteId, personId, editing?.id ?? null, parsed.data).catch(() => null);
    setBusy(false);
    if (!res) return setError("Ödeme kaydedilemedi, bağlantınızı kontrol edip tekrar deneyin.");
    if (!res.ok) return setError(res.error);
    setOpen(false);
    router.refresh();
  }

  async function onDelete() {
    if (!editing || !window.confirm("Bu maaş ödemesi silinsin mi? Kasadaki gider kaydı da silinir.")) return;
    setBusy(true);
    const res = await deleteCashTransaction(siteId, editing.id).catch(() => null);
    setBusy(false);
    if (!res) return setError("Silinemedi, bağlantınızı kontrol edip tekrar deneyin.");
    if (!res.ok) return setError(res.error);
    setOpen(false);
    router.refresh();
  }

  return (
    <section className="space-y-3 rounded-xl border bg-card p-4" aria-label="Maaş ödemeleri">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Maaş Ödemeleri</h2>
          {payments.length > 0 && <p className="text-xs text-muted-foreground">Toplam ödenen: {formatCurrency(grandTotal)}</p>}
        </div>
        {canWrite && (
          <Button type="button" className="h-11" onClick={openNew}>
            <Banknote aria-hidden />
            Maaş Öde
          </Button>
        )}
      </div>

      {payments.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Henüz maaş ödemesi yok.{canWrite && " “Maaş Öde” ile gün × günlük tutar üzerinden ekleyin."}
        </p>
      ) : (
        <ul className="divide-y">
          {payments.map((p) => {
            const editable = canWrite && p.workDays !== null && p.periodMonth !== null;
            const inner = (
              <>
                <span className="min-w-0 flex-1 text-left">
                  <span className="block truncate text-sm font-medium">{p.periodMonth ? monthLabel(p.periodMonth) : p.description}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {formatDate(p.date)}
                    {p.workDays !== null && p.dailyRate !== null && ` · ${p.workDays} gün × ${formatCurrency(p.dailyRate)}`}
                  </span>
                </span>
                <span className="shrink-0 text-sm font-semibold tabular-nums text-orange-700 dark:text-orange-400">{formatCurrency(p.amount)}</span>
              </>
            );
            return (
              <li key={p.id}>
                {editable ? (
                  <button type="button" onClick={() => openEdit(p)} className="flex min-h-14 w-full items-center gap-3 py-2 hover:bg-muted/50">
                    {inner}
                  </button>
                ) : (
                  <div className="flex min-h-14 items-center gap-3 py-2">{inner}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side={side} showCloseButton={false} className="max-h-[92dvh] overflow-y-auto p-0">
          <SheetHeader className="flex-row items-start justify-between gap-2 p-4 pb-0">
            <div className="space-y-1">
              <SheetTitle>{editing ? "Maaş Ödemesini Düzenle" : "Maaş Öde"}</SheetTitle>
              <SheetDescription>{personName} · kasaya gider olarak yazılır (İşçilik).</SheetDescription>
            </div>
            <Button type="button" variant="ghost" className="size-11 shrink-0" aria-label="Kapat" onClick={() => setOpen(false)}>
              <X aria-hidden />
            </Button>
          </SheetHeader>
          <div className="space-y-4 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <FormError message={error} />
            <Field id="pay-month" label="Hakediş ayı">
              <Input
                id="pay-month"
                type="month"
                className="h-11"
                value={month}
                onChange={(e) => {
                  setMonth(e.target.value);
                  if (!editing) daysTouched.current = false;
                }}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field id="pay-days" label="Gün sayısı">
                <Input
                  id="pay-days"
                  inputMode="numeric"
                  autoComplete="off"
                  className="h-11"
                  value={days}
                  onChange={(e) => {
                    daysTouched.current = true;
                    setDays(e.target.value);
                  }}
                />
              </Field>
              <Field id="pay-rate" label="Günlük tutar (₺)">
                <Input id="pay-rate" inputMode="decimal" autoComplete="off" className="h-11" value={rate} onChange={(e) => setRate(e.target.value)} />
              </Field>
            </div>
            <p className="flex items-center justify-between rounded-lg bg-muted px-3 py-3" aria-live="polite">
              <span className="text-sm text-muted-foreground">Ödenecek tutar (gün × günlük)</span>
              <span className="text-lg font-semibold tabular-nums">{formatCurrency(total)}</span>
            </p>
            <Field id="pay-date" label="Ödeme tarihi">
              <Input id="pay-date" type="date" className="h-11" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Field id="pay-method" label="Ödeme yöntemi (opsiyonel)">
              <select id="pay-method" className={selectClass} value={method} onChange={(e) => setMethod(e.target.value)}>
                <option value="">— Belirtilmedi —</option>
                {PAYMENT_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {PAYMENT_METHOD_LABELS[m]}
                  </option>
                ))}
              </select>
            </Field>
            <div className="flex gap-2 pt-1">
              {editing && (
                <Button type="button" variant="destructive" className="h-12 shrink-0" onClick={onDelete} disabled={busy} aria-label="Ödemeyi sil">
                  <Trash2 aria-hidden />
                  Sil
                </Button>
              )}
              <Button type="button" className="h-12 flex-1 text-base" onClick={onSave} disabled={busy}>
                {busy ? <Loader2 className="animate-spin" aria-hidden /> : <Check aria-hidden />}
                {editing ? "Değişiklikleri Kaydet" : "Ödemeyi Kaydet"}
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </section>
  );
}
