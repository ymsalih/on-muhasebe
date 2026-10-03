"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, FilePlus2, Landmark, Loader2, Plus, Receipt, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Field, FormError } from "@/components/auth/field";
import { DataRow } from "@/components/data-row";
import { deleteInvoice, deleteProgressPayment, saveInvoice, saveProgressPayment } from "@/lib/billing/actions";
import { INVOICE_TYPES, INVOICE_TYPE_LABELS, invoiceSchema, progressPaymentSchema, type InvoiceType } from "@/lib/billing/schemas";
import type { BillingSummary, InvoiceRow, PaymentRow } from "@/lib/billing/queries";
import { formatCurrency, formatDate } from "@/lib/format";

const selectClass =
  "h-11 w-full rounded-lg border border-input bg-transparent px-2.5 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30";

const amountText = (n: number) => String(n).replace(".", ",");

/**
 * Hakediş ve Fatura bölümleri + ekleme/düzenleme pencereleri (mobilde bottom-sheet, masaüstünde yan panel).
 * Toplamlar sunucudan gelir (tüm kayıtları kapsar). `canWrite` false ise (admin/viewer) salt okunurdur.
 */
export function BillingBoard({
  siteId,
  canWrite,
  today,
  payments,
  invoices,
  paymentsHasMore,
  invoicesHasMore,
  summary,
}: {
  siteId: number;
  canWrite: boolean;
  today: string;
  payments: PaymentRow[];
  invoices: InvoiceRow[];
  paymentsHasMore: boolean;
  invoicesHasMore: boolean;
  summary: BillingSummary;
}) {
  const router = useRouter();
  const [side, setSide] = useState<"bottom" | "right">("bottom");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // ---- hakediş penceresi ----
  const [payOpen, setPayOpen] = useState(false);
  const [editPay, setEditPay] = useState<PaymentRow | null>(null);
  const [pDate, setPDate] = useState(today);
  const [pDesc, setPDesc] = useState("");
  const [pAmount, setPAmount] = useState("");

  // ---- fatura penceresi ----
  const [invOpen, setInvOpen] = useState(false);
  const [editInv, setEditInv] = useState<InvoiceRow | null>(null);
  const [iDate, setIDate] = useState(today);
  const [iNo, setINo] = useState("");
  const [iType, setIType] = useState<InvoiceType | "">("");
  const [iDesc, setIDesc] = useState("");
  const [iAmount, setIAmount] = useState("");

  const pickSide = () => setSide(window.matchMedia("(min-width: 768px)").matches ? "right" : "bottom");

  function openPayment(r: PaymentRow | null) {
    setEditPay(r);
    setPDate(r?.date ?? today);
    setPDesc(r?.description ?? "");
    setPAmount(r ? amountText(r.amount) : "");
    setError(null);
    pickSide();
    setPayOpen(true);
  }

  function openInvoice(r: InvoiceRow | null) {
    setEditInv(r);
    setIDate(r?.date ?? today);
    setINo(r?.invoiceNo ?? "");
    setIType(r?.type ?? "");
    setIDesc(r?.description ?? "");
    setIAmount(r ? amountText(r.amount) : "");
    setError(null);
    pickSide();
    setInvOpen(true);
  }

  async function run(fn: () => Promise<{ ok: boolean; error?: string } | null>, done: () => void) {
    setBusy(true);
    const res = await fn().catch(() => null);
    setBusy(false);
    if (!res) return setError("İşlem tamamlanamadı, bağlantınızı kontrol edip tekrar deneyin.");
    if (!res.ok) return setError(res.error ?? "İşlem tamamlanamadı.");
    done();
    router.refresh();
  }

  function onSavePayment() {
    setError(null);
    const parsed = progressPaymentSchema.safeParse({ date: pDate, description: pDesc, amount: pAmount });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? "Girilen bilgiler geçersiz.");
    void run(() => saveProgressPayment(siteId, editPay?.id ?? null, parsed.data), () => setPayOpen(false));
  }

  function onDeletePayment() {
    if (!editPay || !window.confirm("Bu hakediş silinsin mi? Toplam hakediş ve eklenmesi gereken fatura güncellenir.")) return;
    void run(() => deleteProgressPayment(siteId, editPay.id), () => setPayOpen(false));
  }

  function onSaveInvoice() {
    setError(null);
    const parsed = invoiceSchema.safeParse({ date: iDate, invoiceNo: iNo, type: iType, description: iDesc, amount: iAmount });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? "Girilen bilgiler geçersiz.");
    void run(() => saveInvoice(siteId, editInv?.id ?? null, parsed.data), () => setInvOpen(false));
  }

  function onDeleteInvoice() {
    if (!editInv || !window.confirm("Bu fatura silinsin mi? Toplam fatura ve eklenmesi gereken fatura güncellenir.")) return;
    void run(() => deleteInvoice(siteId, editInv.id), () => setInvOpen(false));
  }

  return (
    <div className="space-y-6">
      {/* ---------- Hakediş ---------- */}
      <section className="space-y-3" aria-label="Hakediş">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <Landmark className="size-4 text-muted-foreground" aria-hidden />
              Hakediş
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">Toplam hakediş</p>
            <p className="text-xl font-semibold tabular-nums text-emerald-700 dark:text-emerald-400" data-testid="progress-total">
              {formatCurrency(summary.progressTotal)}
            </p>
          </div>
          {canWrite && (
            <Button type="button" className="h-11" onClick={() => openPayment(null)}>
              <Plus aria-hidden />
              Hakediş Ekle
            </Button>
          )}
        </div>
        {payments.length === 0 ? (
          <p className="rounded-xl border border-dashed p-5 text-center text-sm text-muted-foreground">
            Henüz hakediş girilmedi.{canWrite && " “Hakediş Ekle” ile aldığınız hakediş tutarını girin."}
          </p>
        ) : (
          <div className="divide-y rounded-xl border bg-card">
            {payments.map((r) => (
              <DataRow
                key={r.id}
                onClick={canWrite ? () => openPayment(r) : undefined}
                title={r.description || "Hakediş"}
                lines={[formatDate(r.date)]}
                trailing={<span className="text-sm font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">{formatCurrency(r.amount)}</span>}
              />
            ))}
          </div>
        )}
        {paymentsHasMore && <p className="text-xs text-muted-foreground">En yeni 500 hakediş gösteriliyor; toplam tüm kayıtları kapsar.</p>}
      </section>

      {/* ---------- Fatura ---------- */}
      <section className="space-y-3" aria-label="Fatura">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <Receipt className="size-4 text-muted-foreground" aria-hidden />
              Kesilen Faturalar
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">Toplam fatura</p>
            <p className="text-xl font-semibold tabular-nums text-orange-700 dark:text-orange-400" data-testid="invoice-total">
              {formatCurrency(summary.invoiceTotal)}
            </p>
          </div>
          {canWrite && (
            <Button type="button" className="h-11" onClick={() => openInvoice(null)}>
              <FilePlus2 aria-hidden />
              Fatura Ekle
            </Button>
          )}
        </div>
        {summary.byType.length > 0 && (
          <ul className="flex flex-wrap gap-2" aria-label="Fatura türüne göre toplamlar">
            {summary.byType.map((t) => (
              <li key={t.type} className="rounded-full border bg-card px-3 py-1 text-xs">
                <span className="text-muted-foreground">{INVOICE_TYPE_LABELS[t.type]}</span> <span className="font-semibold tabular-nums">{formatCurrency(t.total)}</span>
              </li>
            ))}
          </ul>
        )}
        {invoices.length === 0 ? (
          <p className="rounded-xl border border-dashed p-5 text-center text-sm text-muted-foreground">
            Henüz fatura girilmedi.{canWrite && " Kestiğiniz faturaları “Fatura Ekle” ile girin."}
          </p>
        ) : (
          <div className="divide-y rounded-xl border bg-card">
            {invoices.map((r) => (
              <DataRow
                key={r.id}
                onClick={canWrite ? () => openInvoice(r) : undefined}
                title={r.description}
                badge={<span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">{INVOICE_TYPE_LABELS[r.type]}</span>}
                lines={[[formatDate(r.date), r.invoiceNo && `No: ${r.invoiceNo}`].filter(Boolean).join(" · ")]}
                trailing={<span className="text-sm font-semibold tabular-nums text-orange-700 dark:text-orange-400">{formatCurrency(r.amount)}</span>}
              />
            ))}
          </div>
        )}
        {invoicesHasMore && <p className="text-xs text-muted-foreground">En yeni 500 fatura gösteriliyor; toplam tüm kayıtları kapsar.</p>}
      </section>

      {/* ---------- Hakediş penceresi ---------- */}
      <Sheet open={payOpen} onOpenChange={setPayOpen}>
        <SheetContent side={side} showCloseButton={false} className="max-h-[92dvh] overflow-y-auto p-0">
          <SheetHeader className="flex-row items-start justify-between gap-2 p-4 pb-0">
            <div className="space-y-1">
              <SheetTitle>{editPay ? "Hakedişi Düzenle" : "Hakediş Ekle"}</SheetTitle>
              <SheetDescription>Aldığınız hakediş tutarı toplam hakedişe eklenir.</SheetDescription>
            </div>
            <Button type="button" variant="ghost" className="size-11 shrink-0" aria-label="Kapat" onClick={() => setPayOpen(false)}>
              <X aria-hidden />
            </Button>
          </SheetHeader>
          <div className="space-y-4 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <FormError message={payOpen ? error : null} />
            <Field id="pay-amount" label="Hakediş tutarı (₺)">
              <Input id="pay-amount" inputMode="decimal" autoComplete="off" className="h-11 text-lg font-semibold" value={pAmount} onChange={(e) => setPAmount(e.target.value)} />
            </Field>
            <Field id="pay-date" label="Tarih">
              <Input id="pay-date" type="date" className="h-11" value={pDate} onChange={(e) => setPDate(e.target.value)} />
            </Field>
            <Field id="pay-desc" label="Açıklama (opsiyonel)">
              <Input id="pay-desc" autoComplete="off" placeholder="Ör. 1. hakediş" className="h-11" value={pDesc} onChange={(e) => setPDesc(e.target.value)} />
            </Field>
            <div className="flex gap-2 pt-1">
              {editPay && (
                <Button type="button" variant="destructive" className="h-12 shrink-0" onClick={onDeletePayment} disabled={busy} aria-label="Hakedişi sil">
                  <Trash2 aria-hidden />
                  Sil
                </Button>
              )}
              <Button type="button" className="h-12 flex-1 text-base" onClick={onSavePayment} disabled={busy}>
                {busy ? <Loader2 className="animate-spin" aria-hidden /> : <Check aria-hidden />}
                {editPay ? "Değişiklikleri Kaydet" : "Kaydet"}
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* ---------- Fatura penceresi ---------- */}
      <Sheet open={invOpen} onOpenChange={setInvOpen}>
        <SheetContent side={side} showCloseButton={false} className="max-h-[92dvh] overflow-y-auto p-0">
          <SheetHeader className="flex-row items-start justify-between gap-2 p-4 pb-0">
            <div className="space-y-1">
              <SheetTitle>{editInv ? "Faturayı Düzenle" : "Fatura Ekle"}</SheetTitle>
              <SheetDescription>Kestiğiniz fatura toplam faturaya eklenir.</SheetDescription>
            </div>
            <Button type="button" variant="ghost" className="size-11 shrink-0" aria-label="Kapat" onClick={() => setInvOpen(false)}>
              <X aria-hidden />
            </Button>
          </SheetHeader>
          <div className="space-y-4 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <FormError message={invOpen ? error : null} />
            <Field id="inv-type" label="Fatura türü (ne üzerine kesildi)">
              <select id="inv-type" className={selectClass} value={iType} onChange={(e) => setIType(e.target.value as InvoiceType | "")}>
                <option value="">— Tür seçin —</option>
                {INVOICE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {INVOICE_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
            </Field>
            <Field id="inv-desc" label="Açıklama">
              <Input id="inv-desc" autoComplete="off" placeholder="Ör. Nisan ayı beton malzemesi" className="h-11" value={iDesc} onChange={(e) => setIDesc(e.target.value)} />
            </Field>
            <Field id="inv-amount" label="Fatura tutarı (₺)">
              <Input id="inv-amount" inputMode="decimal" autoComplete="off" className="h-11 text-lg font-semibold" value={iAmount} onChange={(e) => setIAmount(e.target.value)} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field id="inv-date" label="Fatura tarihi">
                <Input id="inv-date" type="date" className="h-11" value={iDate} onChange={(e) => setIDate(e.target.value)} />
              </Field>
              <Field id="inv-no" label="Fatura no (opsiyonel)">
                <Input id="inv-no" autoComplete="off" className="h-11" value={iNo} onChange={(e) => setINo(e.target.value)} />
              </Field>
            </div>
            <div className="flex gap-2 pt-1">
              {editInv && (
                <Button type="button" variant="destructive" className="h-12 shrink-0" onClick={onDeleteInvoice} disabled={busy} aria-label="Faturayı sil">
                  <Trash2 aria-hidden />
                  Sil
                </Button>
              )}
              <Button type="button" className="h-12 flex-1 text-base" onClick={onSaveInvoice} disabled={busy}>
                {busy ? <Loader2 className="animate-spin" aria-hidden /> : <Check aria-hidden />}
                {editInv ? "Değişiklikleri Kaydet" : "Kaydet"}
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
