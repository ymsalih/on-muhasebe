"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Field, FormError } from "@/components/auth/field";
import { DataRow } from "@/components/data-row";
import { deleteDebt, saveDebt } from "@/lib/parties/actions";
import type { DebtRow } from "@/lib/parties/queries";
import { debtSchema } from "@/lib/parties/schemas";
import { formatCurrency, formatDate } from "@/lib/format";

const numText = (n: number) => String(n).replace(".", ",");

/** Cariye yazılan borç kayıtları (en yeniden eskiye). Satıra dokunmak düzenleme/silme penceresini açar. */
export function DebtList({ debts, canWrite, onEdit }: { debts: DebtRow[]; canWrite: boolean; onEdit: (d: DebtRow) => void }) {
  if (debts.length === 0) return null;
  const total = debts.reduce((s, d) => s + d.amount, 0);
  return (
    <section className="space-y-3" aria-label="Borç kayıtları" data-testid="debt-list">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-base font-semibold">Borç Kayıtları</h2>
        <span className="text-xs text-muted-foreground">
          {debts.length} kayıt · toplam <span className="font-semibold tabular-nums text-foreground">{formatCurrency(total)}</span>
        </span>
      </div>
      <div className="divide-y overflow-hidden rounded-xl border bg-card">
        {debts.map((d) => (
          <DataRow
            key={d.id}
            onClick={canWrite ? () => onEdit(d) : undefined}
            title={d.description || "Borç"}
            lines={[formatDate(d.date), d.enteredBy && `${d.enteredBy} girdi`]}
            trailing={<span className="text-sm font-semibold tabular-nums text-red-600 dark:text-red-400">{formatCurrency(d.amount)}</span>}
          />
        ))}
      </div>
    </section>
  );
}

/**
 * Borç ekleme/düzenleme penceresi (mobilde bottom-sheet, masaüstünde yan panel). Yazılan borç, cariye toplam borcunuza eklenir;
 * ödeme yaptıkça kalan borçtan düşer.
 */
export function DebtSheet({
  siteId,
  party,
  open,
  onOpenChange,
  editing,
  today,
}: {
  siteId: number;
  party: { id: number; name: string };
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: DebtRow | null;
  today: string;
}) {
  const router = useRouter();
  const [side, setSide] = useState<"bottom" | "right">("bottom");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(today);
  const [description, setDescription] = useState("");
  // Pencere her açıldığında alanları kayıttan doldur (açılış anında, render sırasında değil)
  const [seen, setSeen] = useState<string>("");
  const key = open ? `${editing?.id ?? "yeni"}` : "";
  if (key !== seen) {
    setSeen(key);
    if (open) {
      setAmount(editing ? numText(editing.amount) : "");
      setDate(editing?.date ?? today);
      setDescription(editing?.description ?? "");
      setError(null);
      if (typeof window !== "undefined") setSide(window.matchMedia("(min-width: 768px)").matches ? "right" : "bottom");
    }
  }

  async function onSave() {
    setError(null);
    const parsed = debtSchema.safeParse({ amount, date, description });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? "Girilen bilgiler geçersiz.");
    setBusy(true);
    const res = await saveDebt(siteId, party.id, editing?.id ?? null, parsed.data).catch(() => null);
    setBusy(false);
    if (!res) return setError("Borç kaydedilemedi, bağlantınızı kontrol edip tekrar deneyin.");
    if (!res.ok) return setError(res.error);
    onOpenChange(false);
    router.refresh();
  }

  async function onDelete() {
    if (!editing || !window.confirm(`${formatCurrency(editing.amount)} tutarındaki borç kaydı silinsin mi? Kalan borç güncellenir.`)) return;
    setBusy(true);
    const res = await deleteDebt(siteId, party.id, editing.id).catch(() => null);
    setBusy(false);
    if (!res) return setError("Silinemedi, bağlantınızı kontrol edip tekrar deneyin.");
    if (!res.ok) return setError(res.error);
    onOpenChange(false);
    router.refresh();
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side={side} showCloseButton={false} className="max-h-[92dvh] overflow-y-auto p-0">
        <SheetHeader className="flex-row items-start justify-between gap-2 p-4 pb-0">
          <div className="space-y-1">
            <SheetTitle>{editing ? "Borcu Düzenle" : "Borç Ekle"}</SheetTitle>
            <SheetDescription>
              {party.name} cariyesine olan borcunuzu yazın. Ödeme yaptıkça kalan borçtan düşer.
            </SheetDescription>
          </div>
          <Button type="button" variant="ghost" className="size-11 shrink-0" aria-label="Kapat" onClick={() => onOpenChange(false)}>
            <X aria-hidden />
          </Button>
        </SheetHeader>
        <div className="space-y-4 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <FormError message={open ? error : null} />
          <Field id="debt-amount" label="Borç tutarı (₺)">
            <Input id="debt-amount" inputMode="decimal" autoComplete="off" className="h-11 text-lg font-semibold" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <Field id="debt-date" label="Borç tarihi">
            <Input id="debt-date" type="date" className="h-11" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field id="debt-desc" label="Açıklama (opsiyonel)">
            <Input id="debt-desc" autoComplete="off" placeholder="Ör. Eski borç, demir alımı" className="h-11" value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
          <div className="flex gap-2 pt-1">
            {editing && (
              <Button type="button" variant="destructive" className="h-12 shrink-0" onClick={onDelete} disabled={busy} aria-label="Borç kaydını sil">
                <Trash2 aria-hidden />
                Sil
              </Button>
            )}
            <Button type="button" className="h-12 flex-1 text-base" onClick={onSave} disabled={busy}>
              {busy ? <Loader2 className="animate-spin" aria-hidden /> : <Check aria-hidden />}
              {editing ? "Değişiklikleri Kaydet" : "Borcu Kaydet"}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
