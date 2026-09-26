"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FormError } from "@/components/auth/field";
import { StickyActionBar } from "@/components/layout/sticky-action-bar";
import { deleteParty, saveParty } from "@/lib/parties/actions";
import { PARTY_CATEGORIES, PARTY_CATEGORY_LABELS } from "@/lib/goods/schemas";
import { partySchema, type PartyValues } from "@/lib/parties/schemas";

const selectClass =
  "h-11 w-full rounded-lg border border-input bg-transparent px-2.5 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30";

/** Cari ekleme/düzenleme. Araç kiralamada "ad" alanına plaka yazılır (CLAUDE.md Bölüm 6). */
export function PartyForm({
  siteId,
  partyId,
  initial,
  canDelete,
}: {
  siteId: number;
  partyId?: number;
  initial: PartyValues;
  canDelete: boolean;
}) {
  const router = useRouter();
  const isEdit = partyId !== undefined;
  const listHref = `/sites/${siteId}/cari`;
  const backHref = isEdit ? `${listHref}/${partyId}` : listHref;

  const [formError, setFormError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<PartyValues>({ resolver: zodResolver(partySchema), defaultValues: initial });

  async function onSubmit(values: PartyValues) {
    setFormError(null);
    const res = await saveParty(siteId, partyId ?? null, values).catch(() => null);
    if (!res) return setFormError("Cari kaydedilemedi, bağlantınızı kontrol edip tekrar deneyin.");
    if (!res.ok) return setFormError(res.error);
    router.replace(`${listHref}/${res.id}`);
    router.refresh();
  }

  async function onDelete() {
    if (partyId === undefined) return;
    if (!window.confirm("Bu cari kalıcı olarak silinsin mi? Bağlı irsaliye, personel veya hareket kaydı varsa silinemez.")) return;
    setDeleting(true);
    setFormError(null);
    const res = await deleteParty(siteId, partyId).catch(() => null);
    setDeleting(false);
    if (!res) return setFormError("Cari silinemedi, bağlantınızı kontrol edip tekrar deneyin.");
    if (!res.ok) return setFormError(res.error);
    router.replace(listHref);
    router.refresh();
  }

  const isVehicle = watch("category") === "arac";

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="max-w-2xl space-y-4 pb-28 md:pb-0" noValidate>
      <FormError message={formError} />

      <fieldset className="space-y-4 rounded-xl border bg-card p-4">
        <legend className="px-1 text-sm font-semibold">Cari Bilgileri</legend>
        <Field id="category" label="Kategori" error={errors.category?.message}>
          <select id="category" className={selectClass} {...register("category")}>
            {PARTY_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {PARTY_CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
        </Field>
        <Field id="name" label={isVehicle ? "Plaka" : "Ad / unvan"} error={errors.name?.message}>
          <Input id="name" autoComplete="off" className="h-11" aria-invalid={!!errors.name} {...register("name")} />
        </Field>
        <Field id="phone" label="Telefon (opsiyonel)" error={errors.phone?.message}>
          <Input id="phone" type="tel" inputMode="tel" autoComplete="off" className="h-11" aria-invalid={!!errors.phone} {...register("phone")} />
        </Field>
        <Field id="address" label="Adres (opsiyonel)" error={errors.address?.message}>
          <Input id="address" autoComplete="off" className="h-11" aria-invalid={!!errors.address} {...register("address")} />
        </Field>
        <Field id="notes" label="Not (opsiyonel)" error={errors.notes?.message}>
          <textarea
            id="notes"
            rows={3}
            className="w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30"
            aria-invalid={!!errors.notes}
            {...register("notes")}
          />
        </Field>
      </fieldset>

      {isEdit && canDelete && (
        <Button type="button" variant="destructive" className="h-11 w-full" onClick={onDelete} disabled={deleting || isSubmitting}>
          {deleting ? <Loader2 className="animate-spin" aria-hidden /> : <Trash2 aria-hidden />}
          Cariyi Sil
        </Button>
      )}

      <StickyActionBar>
        <Link href={backHref} className="hidden h-12 items-center rounded-lg border px-5 text-sm font-medium hover:bg-muted md:inline-flex">
          İptal
        </Link>
        <Button type="submit" className="h-12 flex-1 text-base md:min-w-40 md:flex-none" disabled={isSubmitting || deleting}>
          {isSubmitting && <Loader2 className="animate-spin" aria-hidden />}
          {isEdit ? "Değişiklikleri Kaydet" : "Cariyi Ekle"}
        </Button>
      </StickyActionBar>
    </form>
  );
}
