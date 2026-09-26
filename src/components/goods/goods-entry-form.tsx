"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm, type FieldErrors } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Check, Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FormError } from "@/components/auth/field";
import { StickyActionBar } from "@/components/layout/sticky-action-bar";
import { cn } from "@/lib/utils";
import { createParty, deleteGoodsEntry, saveGoodsEntry, type PartyOption } from "@/lib/goods/actions";
import {
  COMMON_UNITS,
  DOCUMENT_TYPES,
  DOCUMENT_TYPE_LABELS,
  PARTY_CATEGORIES,
  PARTY_CATEGORY_LABELS,
  goodsEntrySchema,
  type GoodsEntryValues,
  type PartyCategory,
} from "@/lib/goods/schemas";

type Suggestions = {
  materials: string[];
  units: string[];
  variants: string[];
  usedLocations: string[];
  purchaseLocations: string[];
};

type Step = { title: string; fields: (keyof GoodsEntryValues)[] };

// CLAUDE.md 7.3-G: 1) Belge Bilgisi 2) Firma ve Malzeme 3) Lokasyon ve Maliyet 4) Not
const STEPS: Step[] = [
  { title: "Belge Bilgisi", fields: ["entryDate", "documentType", "documentNo"] },
  { title: "Firma ve Malzeme", fields: ["partyId", "materialType", "unit", "variant", "quantity"] },
  { title: "Lokasyon ve Maliyet", fields: ["usedLocation", "purchaseLocation", "transportCost"] },
  { title: "Not", fields: ["info"] },
];

const selectClass =
  "h-11 w-full rounded-lg border border-input bg-transparent px-2.5 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30";

const isDesktop = () => window.matchMedia("(min-width: 768px)").matches;

export function GoodsEntryForm({
  siteId,
  entryId,
  initial,
  parties: initialParties,
  suggestions,
}: {
  siteId: number;
  entryId?: number;
  initial: GoodsEntryValues;
  parties: PartyOption[];
  suggestions: Suggestions;
}) {
  const router = useRouter();
  const listHref = `/sites/${siteId}/irsaliye`;
  const isEdit = entryId !== undefined;

  const [step, setStep] = useState(0);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [parties, setParties] = useState(initialParties);
  const [showAddParty, setShowAddParty] = useState(false);
  const [newName, setNewName] = useState("");
  const [newCategory, setNewCategory] = useState<PartyCategory>("firma");
  const [addingParty, setAddingParty] = useState(false);
  const [partyError, setPartyError] = useState<string | null>(null);
  // Yeni eklenen firmanın seçimi, <option> DOM'a çizildikten sonra uygulanır (aksi halde tarayıcı boş seçime düşer).
  const [pendingParty, setPendingParty] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    trigger,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<GoodsEntryValues>({ resolver: zodResolver(goodsEntrySchema), defaultValues: initial });

  const last = STEPS.length - 1;

  useEffect(() => {
    if (pendingParty && parties.some((p) => String(p.id) === pendingParty)) {
      setValue("partyId", pendingParty, { shouldDirty: true, shouldValidate: true });
      setPendingParty(null);
    }
  }, [pendingParty, parties, setValue]);
  const units = [...new Set([...suggestions.units, ...COMMON_UNITS])];

  function goToStep(next: number) {
    setStep(next);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function goNext() {
    if (await trigger(STEPS[step].fields)) goToStep(Math.min(step + 1, last));
  }

  // Son adımda gönderirken önceki bir adımdaki hata gizli kalmasın: ilk hatalı adıma dön.
  function onInvalid(fieldErrors: FieldErrors<GoodsEntryValues>) {
    const bad = STEPS.findIndex((s) => s.fields.some((f) => fieldErrors[f]));
    if (bad >= 0 && !isDesktop()) goToStep(bad);
  }

  async function onSubmit(values: GoodsEntryValues) {
    setFormError(null);
    const result = await saveGoodsEntry(siteId, entryId ?? null, values).catch(() => null);
    if (!result) return setFormError("Kayıt eklenemedi, bağlantınızı kontrol edip tekrar deneyin.");
    if (!result.ok) return setFormError(result.error);
    router.replace(listHref);
    router.refresh();
  }

  const submit = handleSubmit(onSubmit, onInvalid);

  function onFormSubmit(e: React.FormEvent<HTMLFormElement>) {
    // Mobilde ara adımlarda Enter tuşu formu göndermemeli, sonraki adıma geçmeli.
    if (!isDesktop() && step < last) {
      e.preventDefault();
      void goNext();
      return;
    }
    void submit(e);
  }

  async function onAddParty() {
    setPartyError(null);
    if (newName.trim().length < 2) return setPartyError("Firma adı en az 2 karakter olmalı.");
    setAddingParty(true);
    const result = await createParty({ siteId, name: newName, category: newCategory }).catch(() => null);
    setAddingParty(false);
    if (!result) return setPartyError("Firma eklenemedi, bağlantınızı kontrol edip tekrar deneyin.");
    if (!result.ok) return setPartyError(result.error);
    setParties((prev) => [...prev, result.party].sort((a, b) => a.name.localeCompare(b.name, "tr")));
    setPendingParty(String(result.party.id));
    setNewName("");
    setShowAddParty(false);
  }

  async function onDelete() {
    if (!entryId || !window.confirm("Bu kayıt kalıcı olarak silinsin mi?")) return;
    setDeleting(true);
    setFormError(null);
    const result = await deleteGoodsEntry(siteId, entryId).catch(() => null);
    setDeleting(false);
    if (!result) return setFormError("Kayıt silinemedi, bağlantınızı kontrol edip tekrar deneyin.");
    if (!result.ok) return setFormError(result.error);
    router.replace(listHref);
    router.refresh();
  }

  // Mobilde yalnızca aktif adım görünür; masaüstünde (md+) tüm bölümler tek sayfada.
  const section = (i: number) => cn("space-y-4 rounded-xl border bg-card p-4", step !== i && "hidden md:block md:space-y-4");

  return (
    <form onSubmit={onFormSubmit} className="max-w-2xl space-y-4 pb-28 md:pb-0" noValidate>
      {/* Mobil adım göstergesi */}
      <div className="md:hidden" aria-live="polite">
        <div className="mb-1.5 flex items-center justify-between text-sm">
          <span className="font-medium">{STEPS[step].title}</span>
          <span className="text-muted-foreground">
            Adım {step + 1}/{STEPS.length}
          </span>
        </div>
        <div className="flex gap-1.5" aria-hidden>
          {STEPS.map((s, i) => (
            <span key={s.title} className={cn("h-1.5 flex-1 rounded-full", i <= step ? "bg-primary" : "bg-muted")} />
          ))}
        </div>
      </div>

      <FormError message={formError} />

      {/* 1) Belge Bilgisi */}
      <fieldset className={section(0)}>
        <legend className="hidden px-1 text-sm font-semibold md:block">1. Belge Bilgisi</legend>
        <Field id="entryDate" label="Tarih" error={errors.entryDate?.message}>
          <Input id="entryDate" type="date" className="h-11" aria-invalid={!!errors.entryDate} {...register("entryDate")} />
        </Field>
        <div className="space-y-1.5">
          <span id="doctype-label" className="text-sm font-medium">
            Belge türü
          </span>
          <div role="radiogroup" aria-labelledby="doctype-label" className="grid grid-cols-3 gap-2">
            {DOCUMENT_TYPES.map((type) => (
              <label
                key={type}
                className="flex min-h-12 cursor-pointer items-center justify-center rounded-lg border text-sm font-medium has-[:checked]:border-primary has-[:checked]:bg-primary has-[:checked]:text-primary-foreground has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50"
              >
                <input type="radio" value={type} className="sr-only" {...register("documentType")} />
                {DOCUMENT_TYPE_LABELS[type]}
              </label>
            ))}
          </div>
          {errors.documentType && <p role="alert" className="text-sm text-destructive">{errors.documentType.message}</p>}
        </div>
        <Field id="documentNo" label="Belge / irsaliye no" error={errors.documentNo?.message}>
          <Input id="documentNo" autoComplete="off" className="h-11" aria-invalid={!!errors.documentNo} {...register("documentNo")} />
        </Field>
      </fieldset>

      {/* 2) Firma ve Malzeme */}
      <fieldset className={section(1)}>
        <legend className="hidden px-1 text-sm font-semibold md:block">2. Firma ve Malzeme</legend>
        <Field id="partyId" label="Firma" error={errors.partyId?.message}>
          <select id="partyId" className={selectClass} {...register("partyId")}>
            <option value="">— Firma seçilmedi —</option>
            {parties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({PARTY_CATEGORY_LABELS[p.category]})
              </option>
            ))}
          </select>
        </Field>

        {showAddParty ? (
          <div className="space-y-3 rounded-lg border border-dashed p-3">
            <p className="text-sm font-medium">Yeni firma</p>
            <Input
              aria-label="Yeni firma adı"
              placeholder="Firma / kişi adı (araç için plaka)"
              className="h-11"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              autoComplete="off"
            />
            <select
              aria-label="Firma kategorisi"
              className={selectClass}
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value as PartyCategory)}
            >
              {PARTY_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {PARTY_CATEGORY_LABELS[c]}
                </option>
              ))}
            </select>
            {partyError && <p role="alert" className="text-sm text-destructive">{partyError}</p>}
            <div className="flex gap-2">
              <Button type="button" className="h-11 flex-1" onClick={onAddParty} disabled={addingParty}>
                {addingParty ? <Loader2 className="animate-spin" aria-hidden /> : <Check aria-hidden />}
                Ekle
              </Button>
              <Button
                type="button"
                variant="outline"
                className="h-11"
                onClick={() => {
                  setShowAddParty(false);
                  setPartyError(null);
                }}
              >
                Vazgeç
              </Button>
            </div>
          </div>
        ) : (
          <Button type="button" variant="ghost" className="h-11 w-full justify-start text-primary" onClick={() => setShowAddParty(true)}>
            <Plus aria-hidden />
            Listede yok mu? Yeni firma ekle
          </Button>
        )}

        <Field id="materialType" label="Malzeme türü" error={errors.materialType?.message}>
          <Input id="materialType" list="dl-materials" autoComplete="off" className="h-11" aria-invalid={!!errors.materialType} {...register("materialType")} />
        </Field>
        <Field id="variant" label="Çeşidi / cinsi / çapı" error={errors.variant?.message}>
          <Input id="variant" list="dl-variants" autoComplete="off" className="h-11" aria-invalid={!!errors.variant} {...register("variant")} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field id="quantity" label="Miktar" error={errors.quantity?.message}>
            <Input id="quantity" inputMode="decimal" autoComplete="off" className="h-11" aria-invalid={!!errors.quantity} {...register("quantity")} />
          </Field>
          <Field id="unit" label="Birim" error={errors.unit?.message}>
            <Input id="unit" list="dl-units" autoComplete="off" className="h-11" aria-invalid={!!errors.unit} {...register("unit")} />
          </Field>
        </div>
      </fieldset>

      {/* 3) Lokasyon ve Maliyet */}
      <fieldset className={section(2)}>
        <legend className="hidden px-1 text-sm font-semibold md:block">3. Lokasyon ve Maliyet</legend>
        <Field id="usedLocation" label="Kullanıldığı yer" error={errors.usedLocation?.message}>
          <Input id="usedLocation" list="dl-used" autoComplete="off" className="h-11" aria-invalid={!!errors.usedLocation} {...register("usedLocation")} />
        </Field>
        <Field id="purchaseLocation" label="Satın alma yeri" error={errors.purchaseLocation?.message}>
          <Input id="purchaseLocation" list="dl-purchase" autoComplete="off" className="h-11" aria-invalid={!!errors.purchaseLocation} {...register("purchaseLocation")} />
        </Field>
        <Field id="transportCost" label="Nakliye tutarı (₺)" error={errors.transportCost?.message}>
          <Input id="transportCost" inputMode="decimal" autoComplete="off" className="h-11" aria-invalid={!!errors.transportCost} {...register("transportCost")} />
        </Field>
      </fieldset>

      {/* 4) Not */}
      <fieldset className={section(3)}>
        <legend className="hidden px-1 text-sm font-semibold md:block">4. Not</legend>
        <Field id="info" label="Bilgi / not (opsiyonel)" error={errors.info?.message}>
          <textarea
            id="info"
            rows={4}
            className="w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30"
            aria-invalid={!!errors.info}
            {...register("info")}
          />
        </Field>
        {isEdit && (
          <Button type="button" variant="destructive" className="h-11 w-full" onClick={onDelete} disabled={deleting || isSubmitting}>
            {deleting ? <Loader2 className="animate-spin" aria-hidden /> : <Trash2 aria-hidden />}
            Kaydı Sil
          </Button>
        )}
      </fieldset>

      <datalist id="dl-materials">{suggestions.materials.map((v) => <option key={v} value={v} />)}</datalist>
      <datalist id="dl-variants">{suggestions.variants.map((v) => <option key={v} value={v} />)}</datalist>
      <datalist id="dl-units">{units.map((v) => <option key={v} value={v} />)}</datalist>
      <datalist id="dl-used">{suggestions.usedLocations.map((v) => <option key={v} value={v} />)}</datalist>
      <datalist id="dl-purchase">{suggestions.purchaseLocations.map((v) => <option key={v} value={v} />)}</datalist>

      <StickyActionBar>
        {step > 0 && (
          <Button type="button" variant="outline" className="h-12 md:hidden" onClick={() => goToStep(step - 1)}>
            Geri
          </Button>
        )}
        {step < last && (
          <Button type="button" className="h-12 flex-1 text-base md:hidden" onClick={goNext}>
            İleri
          </Button>
        )}
        <Link
          href={listHref}
          className="hidden h-12 items-center rounded-lg border px-5 text-sm font-medium hover:bg-muted md:inline-flex"
        >
          İptal
        </Link>
        <Button
          type="submit"
          className={cn("h-12 flex-1 text-base md:min-w-40 md:flex-none", step < last && "hidden md:inline-flex")}
          disabled={isSubmitting || deleting}
        >
          {isSubmitting && <Loader2 className="animate-spin" aria-hidden />}
          {isEdit ? "Değişiklikleri Kaydet" : "Kaydet"}
        </Button>
      </StickyActionBar>
    </form>
  );
}
