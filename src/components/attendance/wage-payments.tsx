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
import { savePersonPayment } from "@/lib/personnel/payment-actions";
import { monthLabel, personPaymentSchema, wageTotal } from "@/lib/personnel/payment-schemas";
import type { MonthWagePayment } from "@/lib/personnel/payments";
import { PAYMENT_METHODS, PAYMENT_METHOD_LABELS } from "@/lib/parties/schemas";
import { formatCurrency, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

const selectClass =
  "h-11 w-full rounded-lg border border-input bg-transparent px-2.5 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30 disabled:opacity-60";

export type WagePerson = { id: number; name: string; dailyWage: number | null; days: number };

const rateText = (n: number) => String(n).replace(".", ",");
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Puantaj → Maaş Ödemeleri: seçili ayda personelin hakedişi (çalıştığı gün × günlük ücret), yapılan ödemeler ve
 * "Maaş Öde" penceresi. Pencerede kişi seçilince o ayın gün sayısı ve günlük ücreti otomatik gelir; ödeme kasaya
 * "İşçilik" gideri olarak düşer ve isteğe bağlı olarak hangi gelirden ödendiği seçilir.
 */
export function WagePayments({
  siteId,
  ym,
  canWrite,
  today,
  people,
  payments,
  incomeSources,
  incomeLabels,
}: {
  siteId: number;
  ym: string;
  canWrite: boolean;
  today: string;
  people: WagePerson[];
  payments: MonthWagePayment[];
  incomeSources: IncomeSource[];
  incomeLabels: Record<number, string>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<MonthWagePayment | null>(null);
  const [side, setSide] = useState<"bottom" | "right">("bottom");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [personId, setPersonId] = useState("");
  const [days, setDays] = useState("");
  const [rate, setRate] = useState("");
  const [date, setDate] = useState(today);
  const [method, setMethod] = useState("");
  const [source, setSource] = useState("");

  const byPerson = new Map(people.map((p) => [p.id, p]));
  const paidAmount = (pid: number) => payments.filter((p) => p.personnelId === pid).reduce((s, p) => s + p.amount, 0);
  const paidDays = (pid: number) => payments.filter((p) => p.personnelId === pid).reduce((s, p) => s + (p.workDays ?? 0), 0);

  // Özet satırları: o ay çalışan ya da ödeme alan herkes
  const summary = people
    .filter((p) => p.days > 0 || payments.some((x) => x.personnelId === p.id))
    .map((p) => {
      const due = p.dailyWage === null ? null : round2(p.days * p.dailyWage);
      const paid = paidAmount(p.id);
      return { ...p, due, paid, remaining: due === null ? null : round2(due - paid) };
    });
  const totalDue = summary.reduce((s, r) => s + (r.due ?? 0), 0);
  const totalPaid = payments.reduce((s, p) => s + p.amount, 0);

  function pickSide() {
    setSide(window.matchMedia("(min-width: 768px)").matches ? "right" : "bottom");
  }

  /** Kişi seçilince o ayın gün sayısı ve günlük ücreti otomatik gelir (daha önce ödenen günler düşülür). */
  function choosePerson(id: string) {
    setPersonId(id);
    const p = byPerson.get(Number(id));
    if (!p) {
      setDays("");
      setRate("");
      return;
    }
    const already = paidDays(p.id);
    const left = already > 0 ? p.days - already : p.days;
    setDays(left > 0 ? String(left) : "");
    setRate(p.dailyWage === null ? "" : rateText(p.dailyWage));
  }

  function openNew(preselect?: number) {
    setEditing(null);
    setDate(today);
    setMethod("");
    setSource("");
    setError(null);
    pickSide();
    setPersonId("");
    setDays("");
    setRate("");
    if (preselect !== undefined) choosePerson(String(preselect));
    setOpen(true);
  }

  function openEdit(p: MonthWagePayment) {
    if (!canWrite || p.workDays === null || p.dailyRate === null) return;
    setEditing(p);
    setPersonId(String(p.personnelId));
    setDays(String(p.workDays));
    setRate(rateText(p.dailyRate));
    setDate(p.date);
    setMethod(p.method ?? "");
    setSource(p.sourceIncomeId === null ? "" : String(p.sourceIncomeId));
    setError(null);
    pickSide();
    setOpen(true);
  }

  const total = wageTotal(Number(days) || 0, Number(rate.replace(",", ".")) || 0);
  const selPerson = byPerson.get(Number(personId));
  const selSource = incomeSources.find((s) => String(s.id) === source);
  const missingSource = !!source && !selSource;
  // Düzenlenen ödemenin kendi tutarı, aynı kaynakta kalana geri sayılır (yalnızca bilgi; engel değil).
  const available = selSource ? selSource.remaining + (editing && String(editing.sourceIncomeId) === source ? editing.amount : 0) : null;

  async function onSave() {
    setError(null);
    const parsed = personPaymentSchema.safeParse({ month: ym, workDays: days, dailyRate: rate, date, paymentMethod: method, sourceIncomeId: source });
    if (!personId) return setError("Personeli seçin.");
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? "Girilen bilgiler geçersiz.");
    setBusy(true);
    const res = await savePersonPayment(siteId, Number(personId), editing?.id ?? null, parsed.data).catch(() => null);
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
    <section className="space-y-4" aria-label="Maaş ödemeleri">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {monthLabel(ym)}: çalışılan gün × günlük ücret. Ödeme kasaya “İşçilik” gideri olarak düşer.
        </p>
        {canWrite && (
          <Button type="button" className="h-11 shrink-0" onClick={() => openNew()}>
            <Banknote aria-hidden />
            Maaş Öde
          </Button>
        )}
      </div>

      <div className="grid grid-cols-3 gap-2 sm:gap-3" aria-label="Aylık maaş toplamları">
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
          Personel hakedişi
        </h2>
        {summary.length === 0 ? (
          <p className="rounded-xl border border-dashed p-5 text-center text-sm text-muted-foreground">Bu ay puantaj kaydı veya maaş ödemesi yok.</p>
        ) : (
          <div className="divide-y rounded-xl border bg-card">
            {summary.map((r) => (
              <DataRow
                key={r.id}
                onClick={canWrite ? () => openNew(r.id) : undefined}
                title={r.name}
                lines={[
                  r.dailyWage === null ? `${r.days} gün · günlük ücret girilmemiş` : `${r.days} gün × ${formatCurrency(r.dailyWage)} = ${formatCurrency(r.due ?? 0)}`,
                  `Ödenen ${formatCurrency(r.paid)}`,
                ]}
                trailing={
                  r.remaining === null ? (
                    <span className="text-xs text-muted-foreground">—</span>
                  ) : (
                    <span className="block text-right text-xs text-muted-foreground">
                      {r.remaining < 0 ? "Fazla ödeme" : "Kalan"}
                      <span className={cn("block text-sm font-semibold tabular-nums", r.remaining > 0 ? "text-foreground" : r.remaining < 0 ? "text-red-600 dark:text-red-400" : "text-emerald-700 dark:text-emerald-400")}>
                        {formatCurrency(Math.abs(r.remaining))}
                      </span>
                    </span>
                  )
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
            Bu ay maaş ödemesi yok.{canWrite && " “Maaş Öde” ile kişi seçip ödemeyi girin."}
          </p>
        ) : (
          <div className="divide-y rounded-xl border bg-card">
            {payments.map((p) => (
              <DataRow
                key={p.id}
                onClick={canWrite && p.workDays !== null ? () => openEdit(p) : undefined}
                title={p.personName}
                lines={[
                  [formatDate(p.date), p.workDays !== null && p.dailyRate !== null && `${p.workDays} gün × ${formatCurrency(p.dailyRate)}`, p.method && PAYMENT_METHOD_LABELS[p.method]].filter(Boolean).join(" · "),
                  p.sourceIncomeId !== null ? `Kaynak gelir: ${incomeLabels[p.sourceIncomeId] ?? "gelir kaydı"}` : "Kaynak gelir belirtilmedi",
                ]}
                trailing={<span className="text-sm font-semibold tabular-nums text-orange-700 dark:text-orange-400">{formatCurrency(p.amount)}</span>}
              />
            ))}
          </div>
        )}
      </div>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side={side} showCloseButton={false} className="max-h-[92dvh] overflow-y-auto p-0">
          <SheetHeader className="flex-row items-start justify-between gap-2 p-4 pb-0">
            <div className="space-y-1">
              <SheetTitle>{editing ? "Maaş Ödemesini Düzenle" : "Maaş Öde"}</SheetTitle>
              <SheetDescription>{monthLabel(ym)} hakedişi · kasaya gider olarak yazılır (İşçilik).</SheetDescription>
            </div>
            <Button type="button" variant="ghost" className="size-11 shrink-0" aria-label="Kapat" onClick={() => setOpen(false)}>
              <X aria-hidden />
            </Button>
          </SheetHeader>
          <div className="space-y-4 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <FormError message={open ? error : null} />
            <Field id="wp-person" label="Personel">
              <select id="wp-person" className={selectClass} value={personId} disabled={!!editing} onChange={(e) => choosePerson(e.target.value)}>
                <option value="">— Personel seçin —</option>
                {[...people].sort((a, b) => b.days - a.days || a.name.localeCompare(b.name, "tr")).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} — {p.days} gün
                  </option>
                ))}
              </select>
            </Field>
            {selPerson && (
              <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground" aria-live="polite">
                {monthLabel(ym)}: <span className="font-semibold text-foreground">{selPerson.days} gün</span> çalıştı
                {paidDays(selPerson.id) > 0 && !editing && ` · ${paidDays(selPerson.id)} günü daha önce ödendi`}
                {selPerson.dailyWage === null && " · günlük ücreti girilmemiş (aşağıya elle yazın)"}
              </p>
            )}
            <div className="grid grid-cols-2 gap-3">
              <Field id="wp-days" label="Gün sayısı">
                <Input id="wp-days" inputMode="numeric" autoComplete="off" className="h-11" value={days} onChange={(e) => setDays(e.target.value)} />
              </Field>
              <Field id="wp-rate" label="Günlük tutar (₺)">
                <Input id="wp-rate" inputMode="decimal" autoComplete="off" className="h-11" value={rate} onChange={(e) => setRate(e.target.value)} />
              </Field>
            </div>
            <p className="flex items-center justify-between rounded-lg bg-muted px-3 py-3" aria-live="polite">
              <span className="text-sm text-muted-foreground">Ödenecek tutar (gün × günlük)</span>
              <span className="text-lg font-semibold tabular-nums" data-testid="wage-total">{formatCurrency(total)}</span>
            </p>

            <div className="space-y-1.5">
              <Field id="wp-source" label="Hangi gelirden ödendi? (opsiyonel)">
                <select id="wp-source" className={selectClass} value={source} onChange={(e) => setSource(e.target.value)}>
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

            <Field id="wp-date" label="Ödeme tarihi">
              <Input id="wp-date" type="date" className="h-11" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Field id="wp-method" label="Ödeme yöntemi (opsiyonel)">
              <select id="wp-method" className={selectClass} value={method} onChange={(e) => setMethod(e.target.value)}>
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
