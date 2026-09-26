"use client";

import { useEffect, useRef, useState } from "react";
import { Eye, EyeOff, Loader2, Pencil, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/auth/field";
import { revealPersonnelSensitive } from "@/lib/personnel/actions";
import { formatIban } from "@/lib/personnel/schemas";

const MASK = "●●●●●●●●●●●";
/** Açılan değer bu süre sonra kendiliğinden yeniden gizlenir (omuz sörfü / unutulmuş ekran). */
const AUTO_HIDE_MS = 30_000;

type Kind = "tcNo" | "iban";

/**
 * TC no / IBAN alanı (CLAUDE.md 7.3-H): varsayılan gizli (●●●●), "Göster" ile açılır.
 * Gerçek değer sayfa verisinde HİÇ bulunmaz; "Göster" sunucudan tek seferlik çeker (erişim günlüğe yazılır)
 * ve 30 sn sonra siler. Mevcut kayıtta değişiklik yalnızca "Değiştir" ile yapılır; değişmediyse forma dahil edilmez.
 */
export function SensitiveField({
  id,
  label,
  kind,
  personId,
  hasValue,
  canReveal,
  value = "",
  onChange,
  error,
  inputMode,
  maxLength,
  readOnly = false,
}: {
  id: string;
  label: string;
  kind: Kind;
  /** Yoksa yeni kayıt: alan doğrudan düzenlenir. */
  personId?: number;
  hasValue: boolean;
  canReveal: boolean;
  /** Salt görüntülemede (readOnly) gerekmez. */
  value?: string;
  onChange?: (value: string, changed: boolean) => void;
  error?: string;
  inputMode?: "numeric" | "text";
  maxLength?: number;
  /** Salt görüntüleme (admin): değiştirme düğmesi yok. */
  readOnly?: boolean;
}) {
  const isNew = personId === undefined;
  const [mode, setMode] = useState<"masked" | "revealed" | "editing">(isNew ? "editing" : "masked");
  const [revealed, setRevealed] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [revealError, setRevealError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  function hide() {
    if (timer.current) clearTimeout(timer.current);
    setRevealed(null);
    setMode("masked");
  }

  async function reveal() {
    if (personId === undefined) return;
    setRevealError(null);
    setLoading(true);
    const res = await revealPersonnelSensitive(personId).catch(() => null);
    setLoading(false);
    if (!res) return setRevealError("Bilgi getirilemedi, bağlantınızı kontrol edin.");
    if (!res.ok) return setRevealError(res.error);
    setRevealed((kind === "tcNo" ? res.tcNo : res.iban) ?? "");
    setMode("revealed");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(hide, AUTO_HIDE_MS);
  }

  function startEdit(prefill = "") {
    if (timer.current) clearTimeout(timer.current);
    setRevealed(null);
    setMode("editing");
    onChange?.(prefill, true);
  }

  function cancelEdit() {
    setMode("masked");
    onChange?.("", false);
  }

  const shown = revealed ? (kind === "iban" ? formatIban(revealed) : revealed) : "";

  return (
    <div className="space-y-1.5">
      {mode === "editing" ? (
        <>
          <Field id={id} label={label} error={error}>
            <Input
              id={id}
              value={value}
              onChange={(e) => onChange?.(e.target.value, true)}
              inputMode={inputMode}
              maxLength={maxLength}
              autoComplete="off"
              autoCapitalize={kind === "iban" ? "characters" : "none"}
              spellCheck={false}
              className="h-11 font-mono"
              aria-invalid={!!error}
            />
          </Field>
          {!isNew && (
            <div className="flex items-center gap-2">
              <p className="flex-1 text-xs text-muted-foreground">
                {hasValue ? "Boş bırakıp kaydederseniz mevcut bilgi silinir." : "Kaydedince bilgi eklenir."}
              </p>
              <Button type="button" variant="ghost" className="h-11" onClick={cancelEdit}>
                <X aria-hidden />
                Vazgeç
              </Button>
            </div>
          )}
        </>
      ) : (
        <>
          <span id={`${id}-label`} className="text-sm font-medium">
            {label}
          </span>
          <div className="flex min-h-11 flex-wrap items-center gap-2 rounded-lg border bg-muted/40 px-3">
            <span
              aria-labelledby={`${id}-label`}
              className={hasValue ? "flex-1 font-mono text-base tracking-wider" : "flex-1 text-sm text-muted-foreground"}
            >
              {mode === "revealed" ? shown || "—" : hasValue ? MASK : "Girilmedi"}
            </span>
            {mode === "revealed" ? (
              <Button type="button" variant="ghost" className="h-11" onClick={hide}>
                <EyeOff aria-hidden />
                Gizle
              </Button>
            ) : (
              hasValue &&
              canReveal && (
                <Button type="button" variant="ghost" className="h-11" onClick={reveal} disabled={loading}>
                  {loading ? <Loader2 className="animate-spin" aria-hidden /> : <Eye aria-hidden />}
                  Göster
                </Button>
              )
            )}
            {!readOnly && (
              <Button
                type="button"
                variant="ghost"
                className="h-11"
                onClick={() => startEdit(mode === "revealed" ? (revealed ?? "") : "")}
              >
                <Pencil aria-hidden />
                {hasValue ? "Değiştir" : "Ekle"}
              </Button>
            )}
          </div>
          {revealError && (
            <p role="alert" className="text-sm text-destructive">
              {revealError}
            </p>
          )}
          {mode === "revealed" && <p className="text-xs text-muted-foreground">Bu bilgi 30 saniye sonra yeniden gizlenir.</p>}
        </>
      )}
    </div>
  );
}
