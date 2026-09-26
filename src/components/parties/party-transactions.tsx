"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Plus, Receipt, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { DataRow } from "@/components/data-row";
import { Field, FormError } from "@/components/auth/field";
import { StickyActionBar } from "@/components/layout/sticky-action-bar";
import { deleteTransaction, saveTransaction } from "@/lib/parties/actions";
import type { PartyTransaction } from "@/lib/parties/queries";
import {
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
  TX_KINDS,
  TX_KIND_LABELS,
  transactionSchema,
  typeToKind,
  type TransactionValues,
} from "@/lib/parties/schemas";
import { formatCurrency, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

const selectClass =
  "h-11 w-full rounded-lg border border-input bg-transparent px-2.5 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30";

/** Tutarı düzenleme alanı için "1250,5" biçimine çevirir. */
const amountText = (n: number) => String(n).replace(".", ",");

/**
 * Cari hareketleri (CLAUDE.md 7.3-F): kronolojik liste + sabit alt "Ödeme/Tahsilat Ekle" çubuğu.
 * Ekleme/düzenleme, mobilde alttan açılan pencerede (bottom-sheet), masaüstünde yan panelde yapılır.
 * (Faz 7'de Genel Kasa aynı hareket modelini kategori seçimiyle kullanacak.)
 */
export function PartyTransactions({
  siteId,
  partyId,
  transactions,
  canWrite,
  today,
  limit,
}: {
  siteId: number;
  partyId: number;
  transactions: PartyTransaction[];
  canWrite: boolean;
  today: string;
  limit: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<PartyTransaction | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [side, setSide] = useState<"bottom" | "right">("bottom");

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const update = () => setSide(mq.matches ? "right" : "bottom");
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<TransactionValues>({
    resolver: zodResolver(transactionSchema),
    defaultValues: { kind: "odeme", amount: "", date: today, description: "", paymentMethod: "" },
  });

  function openNew() {
    setEditing(null);
    setFormError(null);
    reset({ kind: "odeme", amount: "", date: today, description: "", paymentMethod: "" });
    setOpen(true);
  }

  function openEdit(t: PartyTransaction) {
    setEditing(t);
    setFormError(null);
    reset({
      kind: typeToKind(t.type),
      amount: amountText(t.amount),
      date: t.transaction_date,
      description: t.description,
      paymentMethod: t.payment_method ?? "",
    });
    setOpen(true);
  }

  async function onSubmit(values: TransactionValues) {
    setFormError(null);
    const res = await saveTransaction(siteId, partyId, editing?.id ?? null, values).catch(() => null);
    if (!res) return setFormError("Kayıt yapılamadı, bağlantınızı kontrol edip tekrar deneyin.");
    if (!res.ok) return setFormError(res.error);
    setOpen(false);
    router.refresh();
  }

  async function onDelete() {
    if (!editing || !window.confirm("Bu hareket silinsin mi? Cari bakiyesi buna göre güncellenir.")) return;
    setDeleting(true);
    setFormError(null);
    const res = await deleteTransaction(siteId, editing.id).catch(() => null);
    setDeleting(false);
    if (!res) return setFormError("Hareket silinemedi, bağlantınızı kontrol edip tekrar deneyin.");
    if (!res.ok) return setFormError(res.error);
    setOpen(false);
    router.refresh();
  }

  const kind = watch("kind");

  return (
    <div className="space-y-3 pb-28 md:pb-0">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-base font-semibold">Hareketler</h2>
        {transactions.length > 0 && <span className="text-xs text-muted-foreground">{transactions.length} kayıt</span>}
      </div>

      {transactions.length === 0 ? (
        <div className="mx-auto flex max-w-sm flex-col items-center gap-3 rounded-xl border bg-card px-4 py-10 text-center">
          <Receipt className="size-8 text-muted-foreground" aria-hidden />
          <p className="font-medium">Bu cariye ait hareket yok</p>
          <p className="text-sm text-muted-foreground">
            {canWrite ? "İlk ödeme veya tahsilatı ekleyin; bakiye buna göre hesaplanır." : "Ödeme ve tahsilatlar eklendikçe burada listelenir."}
          </p>
        </div>
      ) : (
        <div className="divide-y rounded-xl border bg-card">
          {transactions.map((t) => {
            const income = t.type === "income";
            return (
              <DataRow
                key={t.id}
                onClick={canWrite ? () => openEdit(t) : undefined}
                title={t.description}
                badge={
                  <span
                    className={cn(
                      "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium",
                      income
                        ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400"
                        : "bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-400",
                    )}
                  >
                    {TX_KIND_LABELS[typeToKind(t.type)]}
                  </span>
                }
                lines={[
                  [formatDate(t.transaction_date), t.payment_method && PAYMENT_METHOD_LABELS[t.payment_method]].filter(Boolean).join(" · "),
                  t.users?.full_name && `${t.users.full_name} girdi`,
                ]}
                trailing={
                  <span className={cn("font-semibold tabular-nums", income ? "text-emerald-700 dark:text-emerald-400" : "text-orange-700 dark:text-orange-400")}>
                    {income ? "+" : "−"}
                    {formatCurrency(t.amount)}
                  </span>
                }
              />
            );
          })}
        </div>
      )}
      {transactions.length >= limit && <p className="text-center text-xs text-muted-foreground">En yeni {limit} hareket gösteriliyor.</p>}

      {canWrite && (
        <StickyActionBar>
          <Button type="button" className="h-12 flex-1 text-base md:flex-none md:px-6" onClick={openNew}>
            <Plus aria-hidden />
            Ödeme / Tahsilat Ekle
          </Button>
        </StickyActionBar>
      )}

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side={side} showCloseButton={false} className="max-h-[92dvh] overflow-y-auto p-0">
          <SheetHeader className="flex-row items-start justify-between gap-2 p-4 pb-0">
            <div className="space-y-1">
              <SheetTitle>{editing ? "Hareketi Düzenle" : "Ödeme / Tahsilat Ekle"}</SheetTitle>
              <SheetDescription>Cari bakiyesi tahsilat − ödeme olarak hesaplanır.</SheetDescription>
            </div>
            <Button type="button" variant="ghost" className="size-11 shrink-0" aria-label="Kapat" onClick={() => setOpen(false)}>
              <X aria-hidden />
            </Button>
          </SheetHeader>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]" noValidate>
            <FormError message={formError} />

            <div className="space-y-1.5">
              <span id="kind-label" className="text-sm font-medium">
                Tür
              </span>
              <div role="radiogroup" aria-labelledby="kind-label" className="grid grid-cols-2 gap-2">
                {TX_KINDS.map((k) => (
                  <label
                    key={k}
                    className={cn(
                      "flex min-h-12 cursor-pointer items-center justify-center rounded-lg border text-sm font-medium has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50",
                      kind === k && (k === "tahsilat" ? "border-emerald-600 bg-emerald-600 text-white" : "border-orange-600 bg-orange-600 text-white"),
                    )}
                  >
                    <input type="radio" value={k} className="sr-only" {...register("kind")} />
                    {TX_KIND_LABELS[k]}
                  </label>
                ))}
              </div>
              {errors.kind && <p role="alert" className="text-sm text-destructive">{errors.kind.message}</p>}
            </div>

            <Field id="tx-amount" label="Tutar (₺)" error={errors.amount?.message}>
              <Input
                id="tx-amount"
                inputMode="decimal"
                autoComplete="off"
                className="h-11 text-lg font-semibold"
                aria-invalid={!!errors.amount}
                {...register("amount")}
              />
            </Field>
            <Field id="tx-date" label="Tarih" error={errors.date?.message}>
              <Input id="tx-date" type="date" className="h-11" aria-invalid={!!errors.date} {...register("date")} />
            </Field>
            <Field id="tx-description" label="Açıklama" error={errors.description?.message}>
              <Input
                id="tx-description"
                autoComplete="off"
                placeholder="Kime / ne için"
                className="h-11"
                aria-invalid={!!errors.description}
                {...register("description")}
              />
            </Field>
            <Field id="tx-method" label="Ödeme yöntemi (opsiyonel)" error={errors.paymentMethod?.message}>
              <select id="tx-method" className={selectClass} {...register("paymentMethod")}>
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
                <Button type="button" variant="destructive" className="h-12 shrink-0" onClick={onDelete} disabled={deleting || isSubmitting} aria-label="Hareketi sil">
                  {deleting ? <Loader2 className="animate-spin" aria-hidden /> : <Trash2 aria-hidden />}
                  Sil
                </Button>
              )}
              <Button type="submit" className="h-12 flex-1 text-base" disabled={isSubmitting || deleting}>
                {isSubmitting && <Loader2 className="animate-spin" aria-hidden />}
                {editing ? "Değişiklikleri Kaydet" : kind === "tahsilat" ? "Tahsilatı Kaydet" : "Ödemeyi Kaydet"}
              </Button>
            </div>
          </form>
        </SheetContent>
      </Sheet>
    </div>
  );
}
