"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Field, FormError } from "@/components/auth/field";
import { DataRow } from "@/components/data-row";
import { deleteCheque, saveCheque } from "@/lib/cheques/actions";
import type { ChequeRow } from "@/lib/cheques/queries";
import {
  ALERT_DAYS,
  CHEQUE_DIRECTIONS,
  CHEQUE_DIRECTION_LABELS,
  CHEQUE_PARTY_LABELS,
  CHEQUE_STATUSES,
  chequeSchema,
  chequeStatusLabel,
  daysUntil,
  dueText,
  type ChequeDirection,
  type ChequeStatus,
} from "@/lib/cheques/schemas";
import { formatCurrency, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

const numText = (n: number) => String(n).replace(".", ",");

const SEGMENT = "min-h-11 rounded-md px-3 text-sm font-medium";

/**
 * Çek listesi ve ekleme/düzenleme penceresi (mobilde bottom-sheet, masaüstünde yan panel).
 * Bekleyen çeklerde vade rengi: vadesi geçmiş kırmızı, 7 gün içinde amber. Yazma yetkisi yoksa (viewer/admin) salt okunurdur.
 */
export function ChequeBoard({
  siteId,
  canWrite,
  today,
  rows,
  hasMore,
  suggestions,
  emptyText,
}: {
  siteId: number;
  canWrite: boolean;
  today: string;
  rows: ChequeRow[];
  hasMore: boolean;
  suggestions: { parties: string[]; banks: string[] };
  emptyText: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ChequeRow | null>(null);
  const [side, setSide] = useState<"bottom" | "right">("bottom");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [direction, setDirection] = useState<ChequeDirection>("received");
  const [counterparty, setCounterparty] = useState("");
  const [amount, setAmount] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [issueDate, setIssueDate] = useState("");
  const [chequeNo, setChequeNo] = useState("");
  const [bank, setBank] = useState("");
  const [note, setNote] = useState("");
  const [status, setStatus] = useState<ChequeStatus>("pending");
  const [settledDate, setSettledDate] = useState(today);

  function show(row: ChequeRow | null) {
    setEditing(row);
    setDirection(row?.direction ?? "received");
    setCounterparty(row?.counterparty ?? "");
    setAmount(row ? numText(row.amount) : "");
    setDueDate(row?.dueDate ?? "");
    setIssueDate(row?.issueDate ?? "");
    setChequeNo(row?.chequeNo ?? "");
    setBank(row?.bank ?? "");
    setNote(row?.note ?? "");
    setStatus(row?.status ?? "pending");
    setSettledDate(row?.settledDate ?? today);
    setError(null);
    setSide(window.matchMedia("(min-width: 768px)").matches ? "right" : "bottom");
    setOpen(true);
  }

  async function onSave() {
    setError(null);
    const parsed = chequeSchema.safeParse({ direction, counterparty, amount, dueDate, issueDate, chequeNo, bank, note, status, settledDate: status === "settled" ? settledDate : "" });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? "Girilen bilgiler geçersiz.");
    setBusy(true);
    const res = await saveCheque(siteId, editing?.id ?? null, parsed.data).catch(() => null);
    setBusy(false);
    if (!res) return setError("Çek kaydedilemedi, bağlantınızı kontrol edip tekrar deneyin.");
    if (!res.ok) return setError(res.error);
    setOpen(false);
    router.refresh();
  }

  async function onDelete() {
    if (!editing || !window.confirm(`${editing.counterparty} çeki (${formatCurrency(editing.amount)}) silinsin mi?`)) return;
    setBusy(true);
    const res = await deleteCheque(siteId, editing.id).catch(() => null);
    setBusy(false);
    if (!res) return setError("Silinemedi, bağlantınızı kontrol edip tekrar deneyin.");
    if (!res.ok) return setError(res.error);
    setOpen(false);
    router.refresh();
  }

  return (
    <section className="space-y-3" aria-label="Çekler">
      {canWrite && (
        <Button type="button" className="h-11" onClick={() => show(null)} data-testid="add-cheque">
          <Plus aria-hidden />
          Çek Ekle
        </Button>
      )}

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
          {emptyText}
          {canWrite && (
            <div className="mt-3">
              <Button type="button" className="h-11" onClick={() => show(null)}>
                <Plus aria-hidden />
                İlk çeki ekle
              </Button>
            </div>
          )}
        </div>
      ) : (
        <div className="divide-y overflow-hidden rounded-xl border bg-card" data-testid="cheque-list">
          {rows.map((r) => {
            const left = daysUntil(r.dueDate, today);
            const pending = r.status === "pending";
            const overdue = pending && left < 0;
            const soon = pending && left >= 0 && left <= ALERT_DAYS;
            const received = r.direction === "received";
            return (
              <DataRow
                key={r.id}
                onClick={canWrite ? () => show(r) : undefined}
                className={cn(overdue && "border-l-4 border-red-500", soon && "border-l-4 border-amber-500")}
                title={r.counterparty}
                badge={
                  <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium", received ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" : "bg-orange-500/15 text-orange-700 dark:text-orange-300")}>
                    {received ? "Alınan" : "Verilen"}
                  </span>
                }
                lines={[
                  pending ? (
                    <span key="due" className={cn(overdue && "font-semibold text-red-600 dark:text-red-400", soon && "font-semibold text-amber-700 dark:text-amber-300")}>
                      Vade {formatDate(r.dueDate)} · {dueText(left)}
                    </span>
                  ) : (
                    `Vade ${formatDate(r.dueDate)}${r.status === "settled" && r.settledDate ? ` · ${chequeStatusLabel("settled", r.direction)} ${formatDate(r.settledDate)}` : ""}`
                  ),
                  [r.bank, r.chequeNo && `No: ${r.chequeNo}`].filter(Boolean).join(" · ") || null,
                  r.note,
                ]}
                trailing={
                  <span className="block text-right">
                    <span className={cn("block text-sm font-semibold tabular-nums", received ? "text-emerald-700 dark:text-emerald-400" : "text-orange-700 dark:text-orange-400", r.status === "cancelled" && "line-through opacity-70")}>
                      {formatCurrency(r.amount)}
                    </span>
                    {!pending && (
                      <span className={cn("block text-[11px]", r.status === "bounced" ? "font-medium text-red-600 dark:text-red-400" : "text-muted-foreground")}>
                        {chequeStatusLabel(r.status, r.direction)}
                      </span>
                    )}
                  </span>
                }
              />
            );
          })}
        </div>
      )}
      {hasMore && <p className="text-xs text-muted-foreground">Çok kayıt var; ilk 300 tanesi gösteriliyor. Toplamlar tüm kayıtları kapsar.</p>}

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side={side} showCloseButton={false} className="max-h-[92dvh] overflow-y-auto p-0">
          <SheetHeader className="flex-row items-start justify-between gap-2 p-4 pb-0">
            <div className="space-y-1">
              <SheetTitle>{editing ? "Çeki Düzenle" : "Çek Ekle"}</SheetTitle>
              <SheetDescription>Vade tarihi yaklaştığında ana sayfada uyarı olarak görünür.</SheetDescription>
            </div>
            <Button type="button" variant="ghost" className="size-11 shrink-0" aria-label="Kapat" onClick={() => setOpen(false)}>
              <X aria-hidden />
            </Button>
          </SheetHeader>
          <div className="space-y-4 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <FormError message={open ? error : null} />

            {editing && (
              <div className="space-y-1.5">
                <Label>Durum</Label>
                <div role="group" aria-label="Çek durumu" className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1">
                  {CHEQUE_STATUSES.map((s) => (
                    <button
                      key={s}
                      type="button"
                      aria-pressed={status === s}
                      data-testid={`status-${s}`}
                      onClick={() => setStatus(s)}
                      className={cn(SEGMENT, status === s ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground")}
                    >
                      {chequeStatusLabel(s, direction)}
                    </button>
                  ))}
                </div>
                {status === "settled" && (
                  <Field id="ch-settled" label={direction === "received" ? "Tahsil tarihi" : "Ödeme tarihi"}>
                    <Input id="ch-settled" type="date" className="h-11" value={settledDate} onChange={(e) => setSettledDate(e.target.value)} />
                  </Field>
                )}
              </div>
            )}

            <div className="space-y-1.5">
              <Label>Çek türü</Label>
              <div role="group" aria-label="Çek türü" className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1">
                {CHEQUE_DIRECTIONS.map((d) => (
                  <button
                    key={d}
                    type="button"
                    aria-pressed={direction === d}
                    data-testid={`direction-${d}`}
                    onClick={() => setDirection(d)}
                    className={cn(SEGMENT, direction === d ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground")}
                  >
                    {CHEQUE_DIRECTION_LABELS[d]}
                  </button>
                ))}
              </div>
            </div>
            <Field id="ch-party" label={CHEQUE_PARTY_LABELS[direction]}>
              <Input id="ch-party" list="dl-ch-parties" autoComplete="off" className="h-11" value={counterparty} onChange={(e) => setCounterparty(e.target.value)} />
            </Field>
            <Field id="ch-amount" label="Tutar (₺)">
              <Input id="ch-amount" inputMode="decimal" autoComplete="off" className="h-11 text-lg font-semibold" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </Field>
            <Field id="ch-due" label="Vade tarihi (ödeme günü)">
              <Input id="ch-due" type="date" className="h-11" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field id="ch-no" label="Çek no (opsiyonel)">
                <Input id="ch-no" autoComplete="off" className="h-11" value={chequeNo} onChange={(e) => setChequeNo(e.target.value)} />
              </Field>
              <Field id="ch-bank" label="Banka (opsiyonel)">
                <Input id="ch-bank" list="dl-ch-banks" autoComplete="off" className="h-11" value={bank} onChange={(e) => setBank(e.target.value)} />
              </Field>
            </div>
            <Field id="ch-issue" label="Düzenleme tarihi (opsiyonel)">
              <Input id="ch-issue" type="date" className="h-11" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
            </Field>
            <Field id="ch-note" label="Not (opsiyonel)">
              <Input id="ch-note" autoComplete="off" className="h-11" value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
            <datalist id="dl-ch-parties">{suggestions.parties.map((v) => <option key={v} value={v} />)}</datalist>
            <datalist id="dl-ch-banks">{suggestions.banks.map((v) => <option key={v} value={v} />)}</datalist>

            <div className="flex gap-2 pt-1">
              {editing && (
                <Button type="button" variant="destructive" className="h-12 shrink-0" onClick={onDelete} disabled={busy} aria-label="Çeki sil">
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
