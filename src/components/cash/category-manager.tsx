"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Lock, Pencil, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormError } from "@/components/auth/field";
import { createCategory, deleteCategory, renameCategory, type CategoryOption } from "@/lib/cash/actions";
import { CASH_TYPES, CASH_TYPE_LABELS, type CashType } from "@/lib/cash/schemas";
import { cn } from "@/lib/utils";

const selectClass =
  "h-11 rounded-lg border border-input bg-transparent px-2.5 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30";

/**
 * Kategori yönetimi: varsayılan kategoriler (kilitli) ve şantiyeye özel kategoriler (yeniden adlandır / sil / ekle).
 * Hareketi olan kategori silinemez (veritabanı engeller, anlaşılır mesaj gösterilir).
 */
export function CategoryManager({
  siteId,
  categories,
  canWrite,
  usage,
}: {
  siteId: number;
  categories: CategoryOption[];
  canWrite: boolean;
  /** category_id → hareket sayısı (bu şantiyede) */
  usage: Record<number, number>;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState<{ id: number; name: string } | null>(null);
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState<CashType>("expense");

  function run(action: () => Promise<{ ok: boolean; error?: string }>, done?: () => void) {
    setError(null);
    startTransition(async () => {
      const res = await action().catch(() => null);
      if (!res) return setError("İşlem tamamlanamadı, bağlantınızı kontrol edip tekrar deneyin.");
      if (!res.ok) return setError(res.error ?? "İşlem tamamlanamadı.");
      done?.();
      router.refresh();
    });
  }

  return (
    <div className="space-y-5">
      <FormError message={error} />

      {canWrite && (
        <form
          className="space-y-3 rounded-xl border bg-card p-4"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => createCategory({ siteId, name: newName, type: newType }), () => setNewName(""));
          }}
        >
          <h2 className="text-sm font-semibold">Yeni Kategori</h2>
          <div className="flex flex-wrap gap-2">
            <Input aria-label="Kategori adı" placeholder="Kategori adı" className="h-11 min-w-0 flex-1 basis-40" value={newName} onChange={(e) => setNewName(e.target.value)} autoComplete="off" />
            <select aria-label="Tür" className={selectClass} value={newType} onChange={(e) => setNewType(e.target.value as CashType)}>
              {CASH_TYPES.map((t) => (
                <option key={t} value={t}>
                  {CASH_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
            <Button type="submit" className="h-11" disabled={pending}>
              {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Plus aria-hidden />}
              Ekle
            </Button>
          </div>
        </form>
      )}

      {CASH_TYPES.map((type) => {
        const list = categories.filter((c) => c.type === type);
        return (
          <section key={type} className="space-y-2">
            <h2 className="text-sm font-semibold">{CASH_TYPE_LABELS[type]} kategorileri</h2>
            <ul className="divide-y rounded-xl border bg-card">
              {list.map((c) => {
                const isDefault = c.site_id === null;
                const count = usage[c.id] ?? 0;
                const isEditing = editing?.id === c.id;
                return (
                  <li key={c.id} className="flex min-h-14 items-center gap-2 px-4 py-2">
                    {isEditing ? (
                      <>
                        <Input
                          autoFocus
                          aria-label={`${c.name} yeni adı`}
                          className="h-11 min-w-0 flex-1"
                          value={editing.name}
                          onChange={(e) => setEditing({ id: c.id, name: e.target.value })}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              run(() => renameCategory(siteId, c.id, editing.name), () => setEditing(null));
                            }
                          }}
                        />
                        <Button type="button" className="size-11" aria-label="Kaydet" disabled={pending} onClick={() => run(() => renameCategory(siteId, c.id, editing.name), () => setEditing(null))}>
                          <Check aria-hidden />
                        </Button>
                        <Button type="button" variant="ghost" className="size-11" aria-label="Vazgeç" onClick={() => setEditing(null)}>
                          <X aria-hidden />
                        </Button>
                      </>
                    ) : (
                      <>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{c.name}</span>
                          <span className={cn("block text-xs text-muted-foreground")}>
                            {isDefault ? "Varsayılan" : "Şantiyeye özel"}
                            {count > 0 ? ` · ${count} hareket` : ""}
                          </span>
                        </span>
                        {isDefault ? (
                          <Lock className="size-4 shrink-0 text-muted-foreground" aria-label="Varsayılan kategori değiştirilemez" />
                        ) : (
                          canWrite && (
                            <>
                              <Button type="button" variant="ghost" className="size-11" aria-label={`${c.name} adını değiştir`} onClick={() => setEditing({ id: c.id, name: c.name })}>
                                <Pencil aria-hidden />
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                className="size-11 text-destructive"
                                aria-label={`${c.name} kategorisini sil`}
                                disabled={pending}
                                onClick={() => {
                                  if (window.confirm(`“${c.name}” kategorisi silinsin mi?`)) run(() => deleteCategory(siteId, c.id));
                                }}
                              >
                                <Trash2 aria-hidden />
                              </Button>
                            </>
                          )
                        )}
                      </>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
