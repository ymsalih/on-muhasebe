"use client";

import { useState } from "react";
import { Check, Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/auth/field";
import { createParty, type PartyOption } from "@/lib/goods/actions";
import { PARTY_CATEGORIES, PARTY_CATEGORY_LABELS, type PartyCategory } from "@/lib/goods/schemas";

const selectClass =
  "h-11 w-full rounded-lg border border-input bg-transparent px-2.5 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30";

/**
 * Firma/cari seçici + "Listede yok mu? Yeni firma ekle". Personel formunda kullanılır.
 * (İrsaliye formundaki eşdeğeri kendi içindedir; tam cari yönetimi Faz 6'da.)
 */
export function PartyPicker({
  id,
  label,
  siteId,
  parties,
  onPartiesChange,
  value,
  onChange,
  error,
}: {
  id: string;
  label: string;
  siteId: number;
  parties: PartyOption[];
  onPartiesChange: (parties: PartyOption[]) => void;
  value: string;
  onChange: (value: string) => void;
  error?: string;
}) {
  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState("");
  const [category, setCategory] = useState<PartyCategory>("firma");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  async function onAdd() {
    setAddError(null);
    if (name.trim().length < 2) return setAddError("Firma adı en az 2 karakter olmalı.");
    setAdding(true);
    const result = await createParty({ siteId, name, category }).catch(() => null);
    setAdding(false);
    if (!result) return setAddError("Firma eklenemedi, bağlantınızı kontrol edip tekrar deneyin.");
    if (!result.ok) return setAddError(result.error);
    onPartiesChange([...parties, result.party].sort((a, b) => a.name.localeCompare(b.name, "tr")));
    onChange(String(result.party.id));
    setName("");
    setShowAdd(false);
  }

  return (
    <div className="space-y-2">
      <Field id={id} label={label} error={error}>
        <select id={id} className={selectClass} value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">— Seçilmedi —</option>
          {parties.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} ({PARTY_CATEGORY_LABELS[p.category]})
            </option>
          ))}
        </select>
      </Field>

      {showAdd ? (
        <div className="space-y-3 rounded-lg border border-dashed p-3">
          <p className="text-sm font-medium">Yeni firma</p>
          <Input
            aria-label="Yeni firma adı"
            placeholder="Firma / kişi adı"
            className="h-11"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="off"
          />
          <select
            aria-label="Firma kategorisi"
            className={selectClass}
            value={category}
            onChange={(e) => setCategory(e.target.value as PartyCategory)}
          >
            {PARTY_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {PARTY_CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
          {addError && (
            <p role="alert" className="text-sm text-destructive">
              {addError}
            </p>
          )}
          <div className="flex gap-2">
            <Button type="button" className="h-11 flex-1" onClick={onAdd} disabled={adding}>
              {adding ? <Loader2 className="animate-spin" aria-hidden /> : <Check aria-hidden />}
              Ekle
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-11"
              onClick={() => {
                setShowAdd(false);
                setAddError(null);
              }}
            >
              Vazgeç
            </Button>
          </div>
        </div>
      ) : (
        <Button type="button" variant="ghost" className="h-11 w-full justify-start text-primary" onClick={() => setShowAdd(true)}>
          <Plus aria-hidden />
          Listede yok mu? Yeni firma ekle
        </Button>
      )}
    </div>
  );
}
