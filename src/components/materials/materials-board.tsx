"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDownToLine, ArrowUpFromLine, Check, Loader2, PackagePlus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Field, FormError } from "@/components/auth/field";
import { DataRow } from "@/components/data-row";
import { deleteMaterial, deleteMovement, saveMaterial, saveMovement } from "@/lib/materials/actions";
import { MOVEMENT_TYPES, MOVEMENT_TYPE_LABELS, materialSchema, movementSchema, type MovementType } from "@/lib/materials/schemas";
import type { MaterialSummaryRow, MovementRow } from "@/lib/materials/queries";
import { COMMON_UNITS } from "@/lib/goods/schemas";
import { formatCurrency, formatDate, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

const selectClass =
  "h-11 w-full rounded-lg border border-input bg-transparent px-2.5 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30 disabled:opacity-60";

export type BoardView = "stok" | "hareket" | "cikis";

const label = (name: string, variant: string | null) => (variant ? `${name} · ${variant}` : name);
const numText = (n: number) => String(n).replace(".", ",");

/**
 * Malzeme sayfasının listesi ve pencereleri: Stok (malzeme kartları), Hareketler (giriş/çıkış) ve Çıkış Raporu.
 * Yazma yetkisi yoksa (viewer/admin) her şey salt okunurdur.
 */
export function MaterialsBoard({
  view,
  siteId,
  canWrite,
  today,
  materials,
  movements,
  hasMore,
}: {
  view: BoardView;
  siteId: number;
  canWrite: boolean;
  today: string;
  materials: MaterialSummaryRow[];
  movements: MovementRow[];
  hasMore: boolean;
}) {
  const router = useRouter();
  const [side, setSide] = useState<"bottom" | "right">("bottom");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // ---- malzeme penceresi ----
  const [matOpen, setMatOpen] = useState(false);
  const [editMat, setEditMat] = useState<MaterialSummaryRow | null>(null);
  const [mName, setMName] = useState("");
  const [mVariant, setMVariant] = useState("");
  const [mUnit, setMUnit] = useState("");

  // ---- hareket penceresi ----
  const [movOpen, setMovOpen] = useState(false);
  const [editMov, setEditMov] = useState<MovementRow | null>(null);
  const [mvMaterial, setMvMaterial] = useState("");
  const [mvType, setMvType] = useState<MovementType>("in");
  const [mvDate, setMvDate] = useState(today);
  const [mvQty, setMvQty] = useState("");
  const [mvPrice, setMvPrice] = useState("");
  const [mvParty, setMvParty] = useState("");
  const [mvNote, setMvNote] = useState("");

  const pickSide = () => setSide(window.matchMedia("(min-width: 768px)").matches ? "right" : "bottom");
  const byId = new Map(materials.map((m) => [m.id, m]));

  function openMaterial(m: MaterialSummaryRow | null) {
    setEditMat(m);
    setMName(m?.name ?? "");
    setMVariant(m?.variant ?? "");
    setMUnit(m?.unit ?? "");
    setError(null);
    pickSide();
    setMatOpen(true);
  }

  function openMovement(m: MovementRow | null, type: MovementType = "in") {
    setEditMov(m);
    setMvMaterial(m ? String(m.materialId) : materials.length === 1 ? String(materials[0].id) : "");
    setMvType(m?.type ?? type);
    setMvDate(m?.date ?? today);
    setMvQty(m ? numText(m.quantity) : "");
    setMvPrice(m?.unitPrice != null ? numText(m.unitPrice) : "");
    setMvParty(m?.counterparty ?? "");
    setMvNote(m?.note ?? "");
    setError(null);
    pickSide();
    setMovOpen(true);
  }

  async function run<T extends { ok: boolean; error?: string }>(fn: () => Promise<T | null>, onDone: () => void) {
    setBusy(true);
    const res = await fn().catch(() => null);
    setBusy(false);
    if (!res) return setError("İşlem tamamlanamadı, bağlantınızı kontrol edip tekrar deneyin.");
    if (!res.ok) return setError(res.error ?? "İşlem tamamlanamadı.");
    onDone();
    router.refresh();
  }

  function onSaveMaterial() {
    setError(null);
    const parsed = materialSchema.safeParse({ name: mName, variant: mVariant, unit: mUnit });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? "Girilen bilgiler geçersiz.");
    void run(() => saveMaterial(siteId, editMat?.id ?? null, parsed.data), () => setMatOpen(false));
  }

  function onDeleteMaterial() {
    if (!editMat || !window.confirm(`“${label(editMat.name, editMat.variant)}” malzemesi silinsin mi?`)) return;
    void run(() => deleteMaterial(siteId, editMat.id), () => setMatOpen(false));
  }

  function onSaveMovement() {
    setError(null);
    const parsed = movementSchema.safeParse({ materialId: mvMaterial, type: mvType, date: mvDate, quantity: mvQty, unitPrice: mvType === "in" ? mvPrice : "", counterparty: mvParty, note: mvNote });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? "Girilen bilgiler geçersiz.");
    void run(() => saveMovement(siteId, editMov?.id ?? null, parsed.data), () => setMovOpen(false));
  }

  function onDeleteMovement() {
    if (!editMov || !window.confirm("Bu hareket silinsin mi?")) return;
    void run(() => deleteMovement(siteId, editMov.id), () => setMovOpen(false));
  }

  const selMat = byId.get(Number(mvMaterial));
  // Düzenlenen çıkışın kendi miktarı stoğa geri sayılır (yalnızca bilgi amaçlı ipucu; asıl koruma veritabanında).
  const available = selMat ? selMat.stockQty + (editMov?.type === "out" ? editMov.quantity : 0) : null;
  const qtyNum = Number(mvQty.replace(",", "."));
  const lineTotal = mvType === "in" && mvPrice !== "" && Number.isFinite(qtyNum) && Number.isFinite(Number(mvPrice.replace(",", "."))) ? Math.round(qtyNum * Number(mvPrice.replace(",", ".")) * 100) / 100 : null;

  const valueOf = (r: MovementRow): number | null => {
    if (r.type === "in") return r.unitPrice === null ? null : Math.round(r.quantity * r.unitPrice * 100) / 100;
    const m = byId.get(r.materialId);
    return m && m.avgCost > 0 ? Math.round(r.quantity * m.avgCost * 100) / 100 : null;
  };

  const movementRows = (rows: MovementRow[]) => (
    <div className="divide-y rounded-xl border bg-card">
      {rows.map((r) => {
        const value = valueOf(r);
        const isIn = r.type === "in";
        return (
          <DataRow
            key={r.id}
            onClick={canWrite ? () => openMovement(r) : undefined}
            title={r.material ? label(r.material.name, r.material.variant) : "Silinmiş malzeme"}
            badge={
              <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium", isIn ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400" : "bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-400")}>
                {MOVEMENT_TYPE_LABELS[r.type]}
              </span>
            }
            lines={[
              [formatDate(r.date), r.counterparty && (isIn ? `Kimden: ${r.counterparty}` : `Kime: ${r.counterparty}`)].filter(Boolean).join(" · "),
              r.note,
            ]}
            trailing={
              <span className="block text-right">
                <span className={cn("block text-sm font-semibold tabular-nums", isIn ? "text-emerald-700 dark:text-emerald-400" : "text-orange-700 dark:text-orange-400")}>
                  {isIn ? "+" : "−"}
                  {formatNumber(r.quantity)} {r.material?.unit}
                </span>
                {value !== null && <span className="block text-xs text-muted-foreground tabular-nums">{formatCurrency(value)}</span>}
              </span>
            }
          />
        );
      })}
    </div>
  );

  return (
    <section className="space-y-3" aria-label="Malzemeler">
      {canWrite && (
        <div className="flex flex-wrap gap-2">
          <Button type="button" className="h-11" onClick={() => openMovement(null, "in")} disabled={materials.length === 0}>
            <ArrowDownToLine aria-hidden />
            Giriş Ekle
          </Button>
          <Button type="button" variant="outline" className="h-11" onClick={() => openMovement(null, "out")} disabled={materials.length === 0}>
            <ArrowUpFromLine aria-hidden />
            Çıkış Ekle
          </Button>
          <Button type="button" variant="outline" className="h-11" onClick={() => openMaterial(null)}>
            <PackagePlus aria-hidden />
            Yeni Malzeme
          </Button>
        </div>
      )}

      {view === "stok" &&
        (materials.length === 0 ? (
          <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
            Henüz malzeme eklenmedi.
            {canWrite && (
              <div className="mt-3">
                <Button type="button" className="h-11" onClick={() => openMaterial(null)}>
                  <PackagePlus aria-hidden />
                  İlk malzemeyi ekle
                </Button>
              </div>
            )}
          </div>
        ) : (
          <div className="divide-y rounded-xl border bg-card">
            {materials.map((m) => (
              <DataRow
                key={m.id}
                onClick={canWrite ? () => openMaterial(m) : undefined}
                title={label(m.name, m.variant)}
                lines={[m.avgCost > 0 ? `Ortalama alış: ${formatCurrency(m.avgCost)} / ${m.unit}` : "Alış fiyatı girilmemiş"]}
                trailing={
                  <span className="block text-right">
                    <span className={cn("block text-sm font-semibold tabular-nums", m.stockQty === 0 && "text-muted-foreground")}>
                      {formatNumber(m.stockQty)} {m.unit}
                    </span>
                    <span className="block text-xs text-muted-foreground tabular-nums">{formatCurrency(m.stockValue)}</span>
                  </span>
                }
              />
            ))}
          </div>
        ))}

      {view !== "stok" &&
        (movements.length === 0 ? (
          <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
            {view === "cikis" ? "Bu dönemde çıkış (verilen malzeme) kaydı yok." : "Bu dönemde malzeme hareketi yok."}
          </p>
        ) : (
          movementRows(movements)
        ))}
      {view !== "stok" && hasMore && <p className="text-xs text-muted-foreground">Dönemde çok kayıt var; en yeni 300 tanesi gösteriliyor. Toplamlar tüm kayıtları kapsar.</p>}

      {/* ---------- Malzeme penceresi ---------- */}
      <Sheet open={matOpen} onOpenChange={setMatOpen}>
        <SheetContent side={side} showCloseButton={false} className="max-h-[92dvh] overflow-y-auto p-0">
          <SheetHeader className="flex-row items-start justify-between gap-2 p-4 pb-0">
            <div className="space-y-1">
              <SheetTitle>{editMat ? "Malzemeyi Düzenle" : "Yeni Malzeme"}</SheetTitle>
              <SheetDescription>Malzeme kartı; giriş ve çıkışlar bu karta bağlanır.</SheetDescription>
            </div>
            <Button type="button" variant="ghost" className="size-11 shrink-0" aria-label="Kapat" onClick={() => setMatOpen(false)}>
              <X aria-hidden />
            </Button>
          </SheetHeader>
          <div className="space-y-4 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <FormError message={matOpen ? error : null} />
            <Field id="mat-name" label="Malzeme adı">
              <Input id="mat-name" autoComplete="off" className="h-11" value={mName} onChange={(e) => setMName(e.target.value)} />
            </Field>
            <Field id="mat-variant" label="Cinsi / çeşidi / çapı (opsiyonel)">
              <Input id="mat-variant" autoComplete="off" className="h-11" value={mVariant} onChange={(e) => setMVariant(e.target.value)} />
            </Field>
            <Field id="mat-unit" label="Birim">
              <Input id="mat-unit" list="dl-mat-units" autoComplete="off" className="h-11" value={mUnit} onChange={(e) => setMUnit(e.target.value)} />
              <datalist id="dl-mat-units">
                {COMMON_UNITS.map((u) => (
                  <option key={u} value={u} />
                ))}
              </datalist>
            </Field>
            <div className="flex gap-2 pt-1">
              {editMat && (
                <Button type="button" variant="destructive" className="h-12 shrink-0" onClick={onDeleteMaterial} disabled={busy} aria-label="Malzemeyi sil">
                  <Trash2 aria-hidden />
                  Sil
                </Button>
              )}
              <Button type="button" className="h-12 flex-1 text-base" onClick={onSaveMaterial} disabled={busy}>
                {busy ? <Loader2 className="animate-spin" aria-hidden /> : <Check aria-hidden />}
                {editMat ? "Değişiklikleri Kaydet" : "Kaydet"}
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* ---------- Hareket penceresi ---------- */}
      <Sheet open={movOpen} onOpenChange={setMovOpen}>
        <SheetContent side={side} showCloseButton={false} className="max-h-[92dvh] overflow-y-auto p-0">
          <SheetHeader className="flex-row items-start justify-between gap-2 p-4 pb-0">
            <div className="space-y-1">
              <SheetTitle>{editMov ? "Hareketi Düzenle" : "Giriş / Çıkış Ekle"}</SheetTitle>
              <SheetDescription>Giriş: şantiyeye gelen malzeme. Çıkış: başkasına verdiğiniz malzeme.</SheetDescription>
            </div>
            <Button type="button" variant="ghost" className="size-11 shrink-0" aria-label="Kapat" onClick={() => setMovOpen(false)}>
              <X aria-hidden />
            </Button>
          </SheetHeader>
          <div className="space-y-4 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <FormError message={movOpen ? error : null} />
            <div className="space-y-1.5">
              <span id="mv-type" className="text-sm font-medium">
                Tür
              </span>
              <div role="radiogroup" aria-labelledby="mv-type" className="grid grid-cols-2 gap-2">
                {MOVEMENT_TYPES.map((t) => (
                  <button
                    key={t}
                    type="button"
                    role="radio"
                    aria-checked={mvType === t}
                    disabled={!!editMov}
                    onClick={() => setMvType(t)}
                    className={cn(
                      "flex min-h-12 items-center justify-center rounded-lg border text-sm font-medium disabled:cursor-not-allowed",
                      mvType === t ? (t === "in" ? "border-emerald-600 bg-emerald-600 text-white" : "border-orange-600 bg-orange-600 text-white") : editMov && "opacity-50",
                    )}
                  >
                    {MOVEMENT_TYPE_LABELS[t]}
                  </button>
                ))}
              </div>
            </div>
            <Field id="mv-material" label="Malzeme">
              <select id="mv-material" className={selectClass} value={mvMaterial} disabled={!!editMov} onChange={(e) => setMvMaterial(e.target.value)}>
                <option value="">— Malzeme seçin —</option>
                {materials.map((m) => (
                  <option key={m.id} value={m.id}>
                    {label(m.name, m.variant)} ({m.unit})
                  </option>
                ))}
              </select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field id="mv-qty" label={selMat ? `Miktar (${selMat.unit})` : "Miktar"}>
                <Input id="mv-qty" inputMode="decimal" autoComplete="off" className="h-11" value={mvQty} onChange={(e) => setMvQty(e.target.value)} />
              </Field>
              <Field id="mv-date" label="Tarih">
                <Input id="mv-date" type="date" className="h-11" value={mvDate} onChange={(e) => setMvDate(e.target.value)} />
              </Field>
            </div>
            {mvType === "out" && selMat && available !== null && (
              <p className={cn("rounded-lg px-3 py-2 text-sm", qtyNum > available ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground")} aria-live="polite">
                Eldeki stok: <span className="font-semibold">{formatNumber(available)} {selMat.unit}</span>
                {qtyNum > available && " — girilen miktar stoktan fazla"}
              </p>
            )}
            {mvType === "in" && (
              <>
                <Field id="mv-price" label="Birim fiyat (₺, opsiyonel)">
                  <Input id="mv-price" inputMode="decimal" autoComplete="off" className="h-11" value={mvPrice} onChange={(e) => setMvPrice(e.target.value)} />
                </Field>
                {lineTotal !== null && (
                  <p className="flex items-center justify-between rounded-lg bg-muted px-3 py-2 text-sm" aria-live="polite">
                    <span className="text-muted-foreground">Tutar (miktar × birim fiyat)</span>
                    <span className="font-semibold tabular-nums">{formatCurrency(lineTotal)}</span>
                  </p>
                )}
              </>
            )}
            <Field id="mv-party" label={mvType === "in" ? "Kimden alındı (opsiyonel)" : "Kime verildi (opsiyonel)"}>
              <Input id="mv-party" autoComplete="off" className="h-11" value={mvParty} onChange={(e) => setMvParty(e.target.value)} />
            </Field>
            <Field id="mv-note" label="Not (opsiyonel)">
              <Input id="mv-note" autoComplete="off" className="h-11" value={mvNote} onChange={(e) => setMvNote(e.target.value)} />
            </Field>
            <div className="flex gap-2 pt-1">
              {editMov && (
                <Button type="button" variant="destructive" className="h-12 shrink-0" onClick={onDeleteMovement} disabled={busy} aria-label="Hareketi sil">
                  <Trash2 aria-hidden />
                  Sil
                </Button>
              )}
              <Button type="button" className="h-12 flex-1 text-base" onClick={onSaveMovement} disabled={busy}>
                {busy ? <Loader2 className="animate-spin" aria-hidden /> : <Check aria-hidden />}
                {editMov ? "Değişiklikleri Kaydet" : "Kaydet"}
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </section>
  );
}
