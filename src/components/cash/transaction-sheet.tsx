"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Check, Loader2, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Field, FormError } from "@/components/auth/field";
import { createCategory, deleteCashTransaction, saveCashTransaction, type CategoryOption } from "@/lib/cash/actions";
import { CASH_TYPES, cashTransactionSchema, type CashTransactionValues, type CashType } from "@/lib/cash/schemas";
import { PAYMENT_METHODS, PAYMENT_METHOD_LABELS } from "@/lib/parties/schemas";
import { cn } from "@/lib/utils";

const selectClass =
  "h-11 w-full rounded-lg border border-input bg-transparent px-2.5 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30";

export type SheetTx = {
  id: number;
  type: CashType;
  amount: number;
  date: string;
  description: string;
  categoryId: number | null;
  partyId: number | null;
  method: string | null;
};

/** Tutarı düzenleme alanı için "1250,5" biçimine çevirir. */
const amountText = (n: number) => String(n).replace(".", ",");

/**
 * Gelir/Gider ekleme-düzenleme penceresi (CLAUDE.md 7.3-D): mobilde alttan açılan bottom-sheet, masaüstünde yan panel.
 * Genel Kasa'da ve Cari detayında ortak kullanılır: cari detayında cari sabittir (`lockedParty`) ve etiketler
 * Tahsilat/Ödeme olur (`labels`). Kategori türe (gelir/gider) göre süzülür; listede yoksa yeni kategori eklenebilir.
 */
export function TransactionSheet({
  siteId,
  open,
  onOpenChange,
  editing,
  categories,
  parties,
  lockedParty,
  labels,
  today,
  defaultType = "expense",
}: {
  siteId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: SheetTx | null;
  categories: CategoryOption[];
  parties: { id: number; name: string }[];
  lockedParty?: { id: number; name: string };
  labels: Record<CashType, string>;
  today: string;
  defaultType?: CashType;
}) {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [side, setSide] = useState<"bottom" | "right">("bottom");
  const [cats, setCats] = useState<CategoryOption[]>(categories);
  const [showAddCat, setShowAddCat] = useState(false);
  const [newCat, setNewCat] = useState("");
  const [addingCat, setAddingCat] = useState(false);
  const [catError, setCatError] = useState<string | null>(null);
  // Yeni eklenen kategorinin seçimi, <option> DOM'a çizildikten sonra uygulanır (aksi halde tarayıcı boş seçime düşer).
  const [pendingCategory, setPendingCategory] = useState<string | null>(null);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const update = () => setSide(mq.matches ? "right" : "bottom");
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  // Sunucudan yeni kategori listesi gelince (yenileme) yerel listeyi eşitle.
  useEffect(() => setCats(categories), [categories]);

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<CashTransactionValues>({
    resolver: zodResolver(cashTransactionSchema),
    defaultValues: { type: defaultType, amount: "", date: today, description: "", categoryId: "", partyId: "", paymentMethod: "" },
  });

  // Pencere her açıldığında formu doğru değerlerle başlat.
  useEffect(() => {
    if (!open) return;
    setFormError(null);
    setShowAddCat(false);
    setCatError(null);
    reset(
      editing
        ? {
            type: editing.type,
            amount: amountText(editing.amount),
            date: editing.date,
            description: editing.description,
            categoryId: editing.categoryId === null ? "" : String(editing.categoryId),
            partyId: editing.partyId === null ? "" : String(editing.partyId),
            paymentMethod: (editing.method as CashTransactionValues["paymentMethod"]) ?? "",
          }
        : { type: defaultType, amount: "", date: today, description: "", categoryId: "", partyId: "", paymentMethod: "" },
    );
  }, [open, editing, defaultType, today, reset]);

  const type = watch("type");
  const categoryId = watch("categoryId");
  const typeCats = cats.filter((c) => c.type === type);

  useEffect(() => {
    if (pendingCategory && cats.some((c) => String(c.id) === pendingCategory)) {
      setValue("categoryId", pendingCategory, { shouldDirty: true });
      setPendingCategory(null);
    }
  }, [pendingCategory, cats, setValue]);

  // Tür değişince uyumsuz kategori seçimi temizlenir (veritabanı da türü doğrular).
  useEffect(() => {
    if (categoryId && !typeCats.some((c) => String(c.id) === categoryId)) setValue("categoryId", "");
  }, [type, categoryId, typeCats, setValue]);

  async function onSubmit(values: CashTransactionValues) {
    setFormError(null);
    const res = await saveCashTransaction(siteId, editing?.id ?? null, values, lockedParty?.id).catch(() => null);
    if (!res) return setFormError("Kayıt yapılamadı, bağlantınızı kontrol edip tekrar deneyin.");
    if (!res.ok) return setFormError(res.error);
    onOpenChange(false);
    router.refresh();
  }

  async function onDelete() {
    if (!editing || !window.confirm("Bu hareket silinsin mi? Kasa ve cari bakiyeleri buna göre güncellenir.")) return;
    setDeleting(true);
    setFormError(null);
    const res = await deleteCashTransaction(siteId, editing.id).catch(() => null);
    setDeleting(false);
    if (!res) return setFormError("Hareket silinemedi, bağlantınızı kontrol edip tekrar deneyin.");
    if (!res.ok) return setFormError(res.error);
    onOpenChange(false);
    router.refresh();
  }

  async function onAddCategory() {
    setCatError(null);
    if (newCat.trim().length < 2) return setCatError("Kategori adı en az 2 karakter olmalı.");
    setAddingCat(true);
    const res = await createCategory({ siteId, name: newCat, type }).catch(() => null);
    setAddingCat(false);
    if (!res) return setCatError("Kategori eklenemedi, bağlantınızı kontrol edip tekrar deneyin.");
    if (!res.ok) return setCatError(res.error);
    setCats((prev) => [...prev, res.category].sort((a, b) => a.name.localeCompare(b.name, "tr")));
    setPendingCategory(String(res.category.id));
    setNewCat("");
    setShowAddCat(false);
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side={side} showCloseButton={false} className="max-h-[92dvh] overflow-y-auto p-0">
        <SheetHeader className="flex-row items-start justify-between gap-2 p-4 pb-0">
          <div className="space-y-1">
            <SheetTitle>{editing ? "Hareketi Düzenle" : `${labels.income} / ${labels.expense} Ekle`}</SheetTitle>
            <SheetDescription>{lockedParty ? `Cari: ${lockedParty.name}` : "Genel kasaya gelir veya gider kaydedin."}</SheetDescription>
          </div>
          <Button type="button" variant="ghost" className="size-11 shrink-0" aria-label="Kapat" onClick={() => onOpenChange(false)}>
            <X aria-hidden />
          </Button>
        </SheetHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]" noValidate>
          <FormError message={formError} />

          <div className="space-y-1.5">
            <span id="tx-type-label" className="text-sm font-medium">
              Tür
            </span>
            <div role="radiogroup" aria-labelledby="tx-type-label" className="grid grid-cols-2 gap-2">
              {CASH_TYPES.map((t) => (
                <label
                  key={t}
                  className={cn(
                    "flex min-h-12 cursor-pointer items-center justify-center rounded-lg border text-sm font-medium has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50",
                    type === t && (t === "income" ? "border-emerald-600 bg-emerald-600 text-white" : "border-orange-600 bg-orange-600 text-white"),
                  )}
                >
                  <input type="radio" value={t} className="sr-only" {...register("type")} />
                  {labels[t]}
                </label>
              ))}
            </div>
          </div>

          <Field id="tx-amount" label="Tutar (₺)" error={errors.amount?.message}>
            <Input id="tx-amount" inputMode="decimal" autoComplete="off" className="h-11 text-lg font-semibold" aria-invalid={!!errors.amount} {...register("amount")} />
          </Field>
          <Field id="tx-date" label="Tarih" error={errors.date?.message}>
            <Input id="tx-date" type="date" className="h-11" aria-invalid={!!errors.date} {...register("date")} />
          </Field>
          <Field id="tx-description" label="Açıklama" error={errors.description?.message}>
            <Input id="tx-description" autoComplete="off" placeholder="Kime / ne için" className="h-11" aria-invalid={!!errors.description} {...register("description")} />
          </Field>

          <div className="space-y-2">
            <Field id="tx-category" label="Kategori (opsiyonel)" error={errors.categoryId?.message}>
              <select id="tx-category" className={selectClass} {...register("categoryId")}>
                <option value="">— Kategorisiz —</option>
                {typeCats.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.site_id !== null ? " (şantiyeye özel)" : ""}
                  </option>
                ))}
              </select>
            </Field>
            {showAddCat ? (
              <div className="space-y-2 rounded-lg border border-dashed p-3">
                <Input aria-label="Yeni kategori adı" placeholder={`Yeni ${labels[type].toLocaleLowerCase("tr-TR")} kategorisi`} className="h-11" value={newCat} onChange={(e) => setNewCat(e.target.value)} autoComplete="off" />
                {catError && <p role="alert" className="text-sm text-destructive">{catError}</p>}
                <div className="flex gap-2">
                  <Button type="button" className="h-11 flex-1" onClick={onAddCategory} disabled={addingCat}>
                    {addingCat ? <Loader2 className="animate-spin" aria-hidden /> : <Check aria-hidden />}
                    Ekle
                  </Button>
                  <Button type="button" variant="outline" className="h-11" onClick={() => { setShowAddCat(false); setCatError(null); }}>
                    Vazgeç
                  </Button>
                </div>
              </div>
            ) : (
              <Button type="button" variant="ghost" className="h-11 w-full justify-start text-primary" onClick={() => setShowAddCat(true)}>
                <Plus aria-hidden />
                Listede yok mu? Yeni kategori ekle
              </Button>
            )}
          </div>

          {!lockedParty && (
            <Field id="tx-party" label="Cari (opsiyonel)" error={errors.partyId?.message}>
              <select id="tx-party" className={selectClass} {...register("partyId")}>
                <option value="">— Cari yok —</option>
                {parties.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </Field>
          )}

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
              {editing ? "Değişiklikleri Kaydet" : "Kaydet"}
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
