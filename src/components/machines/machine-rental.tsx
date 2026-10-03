"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Banknote, Check, Loader2, Scale, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Field, FormError } from "@/components/auth/field";
import { DataRow } from "@/components/data-row";
import { deleteCashTransaction } from "@/lib/cash/actions";
import type { IncomeSource } from "@/lib/cash/sources";
import { saveMachineRental } from "@/lib/machines/actions";
import { RATE_UNIT_NOUN, machineRentalSchema, rentalTotal, type RateUnit } from "@/lib/machines/schemas";
import type { RentalPayment } from "@/lib/machines/queries";
import { monthLabel } from "@/lib/personnel/payment-schemas";
import { PAYMENT_METHODS, PAYMENT_METHOD_LABELS } from "@/lib/parties/schemas";
import { formatCurrency, formatDate, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

const selectClass =
  "h-11 w-full rounded-lg border border-input bg-transparent px-2.5 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30 disabled:opacity-60";

/** Kiralık makine ve o ayın çalışması (günlük kirada gün sayısı, saatlik kirada toplam saat). */
export type RentalMachine = {
  id: number;
  name: string;
  supplier: string | null;
  unit: RateUnit;
  rate: number;
  /** Ayda çalışılan miktar: gün sayısı ya da toplam saat */
  worked: number;
  /** Saatlik kirada saati girilmemiş gün sayısı (uyarı için) */
  daysWithoutHours: number;
};

const qtyText = (n: number) => String(n).replace(".", ",");
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * İş Makineleri → Kira Ödemeleri: kiralık makinelerin ay içindeki çalışması (gün veya saat) × birim kira. "Kira Öde" penceresinde
 * makine seçilince o ayın miktarı ve birim kira otomatik gelir; ödeme kasaya "Kira (araç / ekipman)" gideri olarak düşer ve
 * isteğe bağlı olarak hangi gelirden ödendiği seçilir.
 */
export function MachineRental({
  siteId,
  ym,
  canWrite,
  today,
  machines,
  payments,
  incomeSources,
  incomeLabels,
}: {
  siteId: number;
  ym: string;
  canWrite: boolean;
  today: string;
  machines: RentalMachine[];
  payments: RentalPayment[];
  incomeSources: IncomeSource[];
  incomeLabels: Record<number, string>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<RentalPayment | null>(null);
  const [side, setSide] = useState<"bottom" | "right">("bottom");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [machineId, setMachineId] = useState("");
  const [qty, setQty] = useState("");
  const [rate, setRate] = useState("");
  const [date, setDate] = useState(today);
  const [method, setMethod] = useState("");
  const [source, setSource] = useState("");

  const byId = new Map(machines.map((m) => [m.id, m]));
  const paidAmount = (id: number) => payments.filter((p) => p.machineId === id).reduce((s, p) => s + p.amount, 0);
  const paidQty = (id: number) => payments.filter((p) => p.machineId === id).reduce((s, p) => s + (p.qty ?? 0), 0);

  const summary = machines
    .filter((m) => m.worked > 0 || payments.some((p) => p.machineId === m.id))
    .map((m) => {
      const due = round2(m.worked * m.rate);
      const paid = paidAmount(m.id);
      return { ...m, due, paid, remaining: round2(due - paid) };
    });
  const totalDue = summary.reduce((s, r) => s + r.due, 0);
  const totalPaid = payments.reduce((s, p) => s + p.amount, 0);

  const pickSide = () => setSide(window.matchMedia("(min-width: 768px)").matches ? "right" : "bottom");

  /** Makine seçilince o ayın miktarı ve birim kira otomatik gelir (daha önce ödenen miktar düşülür). */
  function chooseMachine(id: string) {
    setMachineId(id);
    const m = byId.get(Number(id));
    if (!m) {
      setQty("");
      setRate("");
      return;
    }
    const already = paidQty(m.id);
    const left = round2(already > 0 ? m.worked - already : m.worked);
    setQty(left > 0 ? qtyText(left) : "");
    setRate(qtyText(m.rate));
  }

  function openNew(preselect?: number) {
    setEditing(null);
    setDate(today);
    setMethod("");
    setSource("");
    setError(null);
    pickSide();
    setMachineId("");
    setQty("");
    setRate("");
    if (preselect !== undefined) chooseMachine(String(preselect));
    setOpen(true);
  }

  function openEdit(p: RentalPayment) {
    if (!canWrite || p.qty === null || p.rate === null) return;
    setEditing(p);
    setMachineId(String(p.machineId));
    setQty(qtyText(p.qty));
    setRate(qtyText(p.rate));
    setDate(p.date);
    setMethod(p.method ?? "");
    setSource(p.sourceIncomeId === null ? "" : String(p.sourceIncomeId));
    setError(null);
    pickSide();
    setOpen(true);
  }

  const total = rentalTotal(Number(qty.replace(",", ".")) || 0, Number(rate.replace(",", ".")) || 0);
  const sel = byId.get(Number(machineId));
  const selSource = incomeSources.find((s) => String(s.id) === source);
  const missingSource = !!source && !selSource;
  const available = selSource ? selSource.remaining + (editing && String(editing.sourceIncomeId) === source ? editing.amount : 0) : null;

  async function onSave() {
    setError(null);
    if (!machineId) return setError("Makineyi seçin.");
    const parsed = machineRentalSchema.safeParse({ month: ym, qty, rate, date, paymentMethod: method, sourceIncomeId: source });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? "Girilen bilgiler geçersiz.");
    setBusy(true);
    const res = await saveMachineRental(siteId, Number(machineId), editing?.id ?? null, parsed.data).catch(() => null);
    setBusy(false);
    if (!res) return setError("Ödeme kaydedilemedi, bağlantınızı kontrol edip tekrar deneyin.");
    if (!res.ok) return setError(res.error);
    setOpen(false);
    router.refresh();
  }

  async function onDelete() {
    if (!editing || !window.confirm("Bu kira ödemesi silinsin mi? Kasadaki gider kaydı da silinir.")) return;
    setBusy(true);
    const res = await deleteCashTransaction(siteId, editing.id).catch(() => null);
    setBusy(false);
    if (!res) return setError("Silinemedi, bağlantınızı kontrol edip tekrar deneyin.");
    if (!res.ok) return setError(res.error);
    setOpen(false);
    router.refresh();
  }

  const unitNoun = (u: RateUnit) => RATE_UNIT_NOUN[u];

  if (machines.length === 0) {
    return (
      <div className="mx-auto flex max-w-sm flex-col items-center gap-3 py-12 text-center">
        <Scale className="size-10 text-muted-foreground" aria-hidden />
        <h2 className="text-lg font-semibold">Kira tanımlı makine yok</h2>
        <p className="text-sm text-muted-foreground">“Makineler” sekmesinden kiralık bir makine ekleyip birim (günlük/saatlik) ve kira tutarını girin.</p>
      </div>
    );
  }

  return (
    <section className="space-y-4" aria-label="Kira ödemeleri">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">{monthLabel(ym)}: çalışılan gün/saat × birim kira. Ödeme kasaya “Kira (araç / ekipman)” gideri olarak düşer.</p>
        {canWrite && (
          <Button type="button" className="h-11 shrink-0" onClick={() => openNew()}>
            <Banknote aria-hidden />
            Kira Öde
          </Button>
        )}
      </div>

      <div className="grid grid-cols-3 gap-2 sm:gap-3" aria-label="Aylık kira toplamları">
        {[
          { label: "Hesaplanan", value: totalDue, tone: "" },
          { label: "Ödenen", value: totalPaid, tone: "text-orange-700 dark:text-orange-400" },
          { label: "Kalan", value: round2(totalDue - totalPaid), tone: totalDue - totalPaid < 0 ? "text-red-600 dark:text-red-400" : "" },
        ].map((c) => (
          <div key={c.label} className="min-w-0 rounded-xl border bg-card p-3">
            <p className="text-xs text-muted-foreground">{c.label}</p>
            <p className={cn("mt-1 break-words text-sm font-semibold tabular-nums sm:text-base", c.tone)}>{formatCurrency(c.value)}</p>
          </div>
        ))}
      </div>

      <div className="space-y-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Scale className="size-4 text-muted-foreground" aria-hidden />
          Makine kirası
        </h2>
        {summary.length === 0 ? (
          <p className="rounded-xl border border-dashed p-5 text-center text-sm text-muted-foreground">Bu ay kiralık makinelerde puantaj veya kira ödemesi yok.</p>
        ) : (
          <div className="divide-y rounded-xl border bg-card">
            {summary.map((r) => (
              <DataRow
                key={r.id}
                onClick={canWrite ? () => openNew(r.id) : undefined}
                title={r.name}
                lines={[
                  `${formatNumber(r.worked)} ${unitNoun(r.unit)} × ${formatCurrency(r.rate)} = ${formatCurrency(r.due)}${r.supplier ? ` · ${r.supplier}` : ""}`,
                  paidQty(r.id) > r.worked ? (
                    <span key="warn" className="font-medium text-amber-700 dark:text-amber-400">
                      Ödenen {formatNumber(paidQty(r.id))} {unitNoun(r.unit)}, puantajda {formatNumber(r.worked)} {unitNoun(r.unit)} — puantaj değişmiş olabilir
                    </span>
                  ) : r.unit === "hour" && r.daysWithoutHours > 0 ? (
                    `${r.daysWithoutHours} günde saat girilmemiş`
                  ) : (
                    `Ödenen ${formatCurrency(r.paid)}`
                  ),
                ]}
                trailing={
                  <span className="block text-right text-xs text-muted-foreground">
                    {r.remaining < 0 ? "Fazla ödeme" : "Kalan"}
                    <span className={cn("block text-sm font-semibold tabular-nums", r.remaining > 0 ? "text-foreground" : r.remaining < 0 ? "text-red-600 dark:text-red-400" : "text-emerald-700 dark:text-emerald-400")}>
                      {formatCurrency(Math.abs(r.remaining))}
                    </span>
                  </span>
                }
              />
            ))}
          </div>
        )}
      </div>

      <div className="space-y-2">
        <h2 className="text-sm font-semibold">Yapılan ödemeler</h2>
        {payments.length === 0 ? (
          <p className="rounded-xl border border-dashed p-5 text-center text-sm text-muted-foreground">
            Bu ay kira ödemesi yok.{canWrite && " “Kira Öde” ile makineyi seçip ödemeyi girin."}
          </p>
        ) : (
          <div className="divide-y rounded-xl border bg-card">
            {payments.map((p) => {
              const m = byId.get(p.machineId);
              return (
                <DataRow
                  key={p.id}
                  onClick={canWrite && p.qty !== null ? () => openEdit(p) : undefined}
                  title={m?.name ?? "Makine"}
                  lines={[
                    [formatDate(p.date), p.qty !== null && p.rate !== null && p.unit && `${formatNumber(p.qty)} ${unitNoun(p.unit)} × ${formatCurrency(p.rate)}`, p.method && PAYMENT_METHOD_LABELS[p.method]].filter(Boolean).join(" · "),
                    p.sourceIncomeId !== null ? `Kaynak gelir: ${incomeLabels[p.sourceIncomeId] ?? "gelir kaydı"}` : "Kaynak gelir belirtilmedi",
                  ]}
                  trailing={<span className="text-sm font-semibold tabular-nums text-orange-700 dark:text-orange-400">{formatCurrency(p.amount)}</span>}
                />
              );
            })}
          </div>
        )}
      </div>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side={side} showCloseButton={false} className="max-h-[92dvh] overflow-y-auto p-0">
          <SheetHeader className="flex-row items-start justify-between gap-2 p-4 pb-0">
            <div className="space-y-1">
              <SheetTitle>{editing ? "Kira Ödemesini Düzenle" : "Kira Öde"}</SheetTitle>
              <SheetDescription>{monthLabel(ym)} kirası · kasaya gider olarak yazılır (Kira — araç / ekipman).</SheetDescription>
            </div>
            <Button type="button" variant="ghost" className="size-11 shrink-0" aria-label="Kapat" onClick={() => setOpen(false)}>
              <X aria-hidden />
            </Button>
          </SheetHeader>
          <div className="space-y-4 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <FormError message={open ? error : null} />
            <Field id="mr-machine" label="Makine">
              <select id="mr-machine" className={selectClass} value={machineId} disabled={!!editing} onChange={(e) => chooseMachine(e.target.value)}>
                <option value="">— Makine seçin —</option>
                {machines.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} — {formatNumber(m.worked)} {unitNoun(m.unit)}
                  </option>
                ))}
              </select>
            </Field>
            {sel && (
              <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground" aria-live="polite">
                {monthLabel(ym)}: <span className="font-semibold text-foreground">{formatNumber(sel.worked)} {unitNoun(sel.unit)}</span> çalıştı
                {paidQty(sel.id) > 0 && !editing && ` · ${formatNumber(paidQty(sel.id))} ${unitNoun(sel.unit)} daha önce ödendi`}
                {sel.unit === "hour" && sel.daysWithoutHours > 0 && ` · ${sel.daysWithoutHours} günde saat girilmemiş`}
              </p>
            )}
            <div className="grid grid-cols-2 gap-3">
              <Field id="mr-qty" label={sel ? `Miktar (${unitNoun(sel.unit)})` : "Miktar"}>
                <Input id="mr-qty" inputMode="decimal" autoComplete="off" className="h-11" value={qty} onChange={(e) => setQty(e.target.value)} />
              </Field>
              <Field id="mr-rate" label={sel ? `Birim kira (₺ / ${unitNoun(sel.unit)})` : "Birim kira (₺)"}>
                <Input id="mr-rate" inputMode="decimal" autoComplete="off" className="h-11" value={rate} onChange={(e) => setRate(e.target.value)} />
              </Field>
            </div>
            <p className="flex items-center justify-between rounded-lg bg-muted px-3 py-3" aria-live="polite">
              <span className="text-sm text-muted-foreground">Ödenecek tutar (miktar × birim kira)</span>
              <span className="text-lg font-semibold tabular-nums" data-testid="rental-total">{formatCurrency(total)}</span>
            </p>

            <div className="space-y-1.5">
              <Field id="mr-source" label="Hangi gelirden ödendi? (opsiyonel)">
                <select id="mr-source" className={selectClass} value={source} onChange={(e) => setSource(e.target.value)}>
                  <option value="">— Belirtilmedi —</option>
                  {missingSource && <option value={source}>Seçili gelir (eski kayıt)</option>}
                  {incomeSources.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </Field>
              {incomeSources.length === 0 && <p className="text-xs text-muted-foreground">Henüz gelir kaydı yok; kasaya gelir ekleyince burada seçebilirsiniz.</p>}
              {available !== null && (
                <p className={cn("rounded-lg px-3 py-2 text-xs", total > available ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300" : "bg-muted text-muted-foreground")} aria-live="polite">
                  Bu gelirden kalan: <span className="font-semibold tabular-nums">{formatCurrency(available)}</span>
                  {total > available && " — bu ödeme kalan tutarı aşıyor (yine de kaydedebilirsiniz)."}
                </p>
              )}
            </div>

            <Field id="mr-date" label="Ödeme tarihi">
              <Input id="mr-date" type="date" className="h-11" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Field id="mr-method" label="Ödeme yöntemi (opsiyonel)">
              <select id="mr-method" className={selectClass} value={method} onChange={(e) => setMethod(e.target.value)}>
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
                {editing ? "Değişiklikleri Kaydet" : "Öde"}
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </section>
  );
}
