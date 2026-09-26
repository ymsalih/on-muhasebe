"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Loader2, MessageSquarePlus, Search, Undo2, Users } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormError } from "@/components/auth/field";
import { StickyActionBar } from "@/components/layout/sticky-action-bar";
import { saveAttendance, setAttendanceNote } from "@/lib/attendance/actions";
import { formatDate } from "@/lib/format";
import { addDays } from "@/lib/personnel/status";
import { cn } from "@/lib/utils";

export type DailyPerson = {
  id: number;
  full_name: string;
  job: string | null;
  duty: string | null;
  /** İşaretli ama o tarihte çalışamayacak görünüyor (ör. sonradan izin girilmiş) — uyarı gösterilir. */
  warning?: string;
};
export type ExcludedPerson = { id: number; full_name: string; reason: string };
/** Kaydedilmiş bir işaretin bilgileri (not, işaretleyen, saat). */
export type PresentMeta = { id: number; note: string | null; markedBy: string | null; markedAt: string };

const UNDO_MS = 10_000;
const timeFmt = (iso: string) =>
  new Date(iso).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Istanbul" });

const NO_GROUP = "Görev belirtilmedi";
const trCompare = (a: string, b: string) => a.localeCompare(b, "tr");

/**
 * Günlük Gelenler (CLAUDE.md 7.3-E): tarih seçici, aktif personel listesi, büyük onay kutuları,
 * alt sabit çubukta "X kişi işaretlendi — Kaydet". Yalnızca DEĞİŞENLER (eklenen/çıkarılan) sunucuya gider.
 */
export function DailyAttendance({
  siteId,
  date,
  today,
  people,
  excluded,
  initialPresent,
  canWrite,
}: {
  siteId: number;
  date: string;
  today: string;
  people: DailyPerson[];
  excluded: ExcludedPerson[];
  initialPresent: PresentMeta[];
  canWrite: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [saved, setSaved] = useState(() => new Set(initialPresent.map((m) => m.id)));
  const [selected, setSelected] = useState(() => new Set(initialPresent.map((m) => m.id)));
  const meta = useMemo(() => new Map(initialPresent.map((m) => [m.id, m])), [initialPresent]);
  const [noteEdits, setNoteEdits] = useState<Record<number, string | null>>({});
  const [editing, setEditing] = useState<{ id: number; text: string } | null>(null);
  const [noteBusy, setNoteBusy] = useState(false);
  const [lastSave, setLastSave] = useState<{ added: number[]; removed: number[] } | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [query, setQuery] = useState("");
  const [groupBy, setGroupBy] = useState<"ad" | "gorev">("ad");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();

  const added = useMemo(() => [...selected].filter((id) => !saved.has(id)), [selected, saved]);
  const removed = useMemo(() => [...saved].filter((id) => !selected.has(id)), [selected, saved]);
  const dirty = added.length > 0 || removed.length > 0;

  // Kaydedilmemiş değişiklikle sekme kapatılırsa uyar.
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  function go(next: string) {
    if (next === date || !/^\d{4}-\d{2}-\d{2}$/.test(next) || next > today) return;
    if (dirty && !window.confirm("Kaydedilmemiş değişiklikler var. Tarihi değiştirirseniz kaybolacak. Devam edilsin mi?")) return;
    router.push(`${pathname}?tarih=${next}`);
  }

  function toggle(id: number) {
    setDone(false);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const visible = useMemo(() => {
    const q = query.trim().toLocaleLowerCase("tr-TR");
    return q ? people.filter((p) => p.full_name.toLocaleLowerCase("tr-TR").includes(q)) : people;
  }, [people, query]);

  const groups = useMemo(() => {
    if (groupBy === "ad") return [{ title: null as string | null, rows: visible }];
    const map = new Map<string, DailyPerson[]>();
    for (const p of visible) {
      const key = (p.duty || p.job || NO_GROUP).trim();
      map.set(key, [...(map.get(key) ?? []), p]);
    }
    return [...map.entries()]
      .sort(([a], [b]) => (a === NO_GROUP ? 1 : b === NO_GROUP ? -1 : trCompare(a, b)))
      .map(([title, rows]) => ({ title, rows }));
  }, [visible, groupBy]);

  function setAllVisible(on: boolean) {
    setDone(false);
    setSelected((prev) => {
      const next = new Set(prev);
      for (const p of visible) on ? next.add(p.id) : next.delete(p.id);
      return next;
    });
  }

  function onSave() {
    setError(null);
    setDone(false);
    startTransition(async () => {
      const res = await saveAttendance({ siteId, date, add: added, remove: removed }).catch(() => null);
      if (!res) return setError("Puantaj kaydedilemedi, bağlantınızı kontrol edip tekrar deneyin.");
      if (!res.ok) return setError(res.error);
      setSaved(new Set(selected));
      setDone(true);
      setLastSave({ added, removed });
      if (undoTimer.current) clearTimeout(undoTimer.current);
      undoTimer.current = setTimeout(() => setLastSave(null), UNDO_MS);
      router.refresh();
    });
  }

  /** Son kaydı tersine çevirir: eklenenleri çıkarır, çıkarılanları geri ekler. */
  function onUndo() {
    if (!lastSave) return;
    const { added: prevAdded, removed: prevRemoved } = lastSave;
    setError(null);
    startTransition(async () => {
      const res = await saveAttendance({ siteId, date, add: prevRemoved, remove: prevAdded }).catch(() => null);
      if (!res) return setError("Geri alınamadı, bağlantınızı kontrol edip tekrar deneyin.");
      if (!res.ok) return setError(res.error);
      const next = new Set(saved);
      prevAdded.forEach((id) => next.delete(id));
      prevRemoved.forEach((id) => next.add(id));
      setSaved(next);
      setSelected(new Set(next));
      setLastSave(null);
      setDone(false);
      router.refresh();
    });
  }

  async function onSaveNote() {
    if (!editing) return;
    setNoteBusy(true);
    setError(null);
    const res = await setAttendanceNote({ siteId, date, personnelId: editing.id, note: editing.text }).catch(() => null);
    setNoteBusy(false);
    if (!res) return setError("Not kaydedilemedi, bağlantınızı kontrol edip tekrar deneyin.");
    if (!res.ok) return setError(res.error);
    setNoteEdits((prev) => ({ ...prev, [editing.id]: editing.text.trim() === "" ? null : editing.text.trim() }));
    setEditing(null);
    router.refresh();
  }

  const isToday = date === today;
  const count = selected.size;

  return (
    <div className="space-y-4 pb-28 md:pb-0">
      {/* Tarih seçici */}
      <div className="flex items-center gap-2">
        <Button type="button" variant="outline" className="size-11 shrink-0" aria-label="Önceki gün" onClick={() => go(addDays(date, -1))}>
          <ChevronLeft aria-hidden />
        </Button>
        <Input
          type="date"
          aria-label="Tarih"
          value={date}
          max={today}
          onChange={(e) => go(e.target.value)}
          className="h-11 min-w-0 flex-1 text-center"
        />
        <Button type="button" variant="outline" className="size-11 shrink-0" aria-label="Sonraki gün" disabled={date >= today} onClick={() => go(addDays(date, 1))}>
          <ChevronRight aria-hidden />
        </Button>
        {!isToday && (
          <Button type="button" variant="ghost" className="h-11 shrink-0" onClick={() => go(today)}>
            Bugün
          </Button>
        )}
      </div>
      <p className="text-sm text-muted-foreground">
        {formatDate(date)}
        {isToday ? " (bugün)" : ""} · {count} kişi işaretli
      </p>

      <FormError message={error} />
      {done && (
        <div role="status" className="flex items-center gap-2 rounded-lg bg-emerald-100 px-3 py-1.5 text-sm text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
          <CheckCircle2 className="size-4 shrink-0" aria-hidden />
          <span className="flex-1">Puantaj kaydedildi.</span>
          {lastSave && canWrite && (
            <Button type="button" variant="ghost" className="h-11 shrink-0 text-emerald-900 dark:text-emerald-200" onClick={onUndo} disabled={pending}>
              <Undo2 aria-hidden />
              Geri al
            </Button>
          )}
        </div>
      )}

      {people.length === 0 ? (
        <div className="mx-auto flex max-w-sm flex-col items-center gap-3 py-12 text-center">
          <Users className="size-10 text-muted-foreground" aria-hidden />
          <h2 className="text-lg font-semibold">Bu tarihte listelenecek personel yok</h2>
          <p className="text-sm text-muted-foreground">
            Personel eklenmemiş olabilir ya da herkes izinli/raporlu/ayrılmış olabilir.
          </p>
          <Link href={`/sites/${siteId}/personel`} className="inline-flex min-h-11 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground">
            Personele git
          </Link>
        </div>
      ) : (
        <>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input type="search" placeholder="Ad soyad ara" aria-label="Personel ara" autoComplete="off" className="h-11 pl-9" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div role="group" aria-label="Gruplama" className="inline-flex rounded-lg bg-muted p-1">
              {(
                [
                  ["ad", "Alfabetik"],
                  ["gorev", "Göreve göre"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={groupBy === value}
                  onClick={() => setGroupBy(value)}
                  className={cn(
                    "min-h-11 rounded-md px-4 text-sm font-medium",
                    groupBy === value ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            {canWrite && (
              <>
                <Button type="button" variant="outline" className="h-11" onClick={() => setAllVisible(true)}>
                  Tümünü işaretle
                </Button>
                <Button type="button" variant="ghost" className="h-11" onClick={() => setAllVisible(false)}>
                  Temizle
                </Button>
              </>
            )}
          </div>

          {visible.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Aramanıza uyan personel yok.</p>
          ) : (
            groups.map(({ title, rows }) => (
              <section key={title ?? "hepsi"} className="overflow-hidden rounded-xl border bg-card">
                {title && (
                  <h2 className="flex items-center justify-between border-b bg-muted/50 px-4 py-2 text-sm font-semibold">
                    {title}
                    <span className="font-normal text-muted-foreground">
                      {rows.filter((r) => selected.has(r.id)).length}/{rows.length}
                    </span>
                  </h2>
                )}
                <ul className="divide-y">
                  {rows.map((p) => {
                    const on = selected.has(p.id);
                    return (
                      <li key={p.id}>
                        <div className={cn("flex items-stretch", on && "bg-emerald-50 dark:bg-emerald-950/30")}>
                          <label className={cn("flex min-h-14 min-w-0 flex-1 items-center gap-3 px-4 py-2", canWrite ? "cursor-pointer hover:bg-muted/40" : "cursor-default")}>
                            <input
                              type="checkbox"
                              checked={on}
                              disabled={!canWrite || pending}
                              onChange={() => toggle(p.id)}
                              className="size-7 shrink-0 accent-emerald-600"
                            />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-medium">{p.full_name}</span>
                              {(p.job || p.duty) && (
                                <span className="block truncate text-xs text-muted-foreground">{[p.job, p.duty].filter(Boolean).join(" · ")}</span>
                              )}
                              {saved.has(p.id) && (
                                <span className="block truncate text-xs text-muted-foreground">
                                  {meta.get(p.id)
                                    ? `${meta.get(p.id)!.markedBy ?? "Bilinmiyor"} işaretledi · ${timeFmt(meta.get(p.id)!.markedAt)}`
                                    : "Az önce işaretlendi"}
                                </span>
                              )}
                              {p.warning && (
                                <span className="mt-0.5 flex items-center gap-1 text-xs text-orange-700 dark:text-orange-400">
                                  <AlertTriangle className="size-3 shrink-0" aria-hidden />
                                  Bu tarihte {p.warning.toLocaleLowerCase("tr-TR")} görünüyor
                                </span>
                              )}
                            </span>
                          </label>
                          {canWrite && saved.has(p.id) && (
                            <button
                              type="button"
                              aria-label={`${p.full_name} için not ekle veya düzenle`}
                              onClick={() => setEditing({ id: p.id, text: (p.id in noteEdits ? noteEdits[p.id] : meta.get(p.id)?.note) ?? "" })}
                              className="flex min-h-14 w-12 shrink-0 items-center justify-center text-muted-foreground hover:bg-muted/40 hover:text-foreground"
                            >
                              <MessageSquarePlus className="size-5" aria-hidden />
                            </button>
                          )}
                        </div>
                        {(() => {
                          const note = p.id in noteEdits ? noteEdits[p.id] : meta.get(p.id)?.note;
                          if (editing?.id === p.id) {
                            return (
                              <div className="flex items-center gap-2 border-t bg-muted/30 px-4 py-2">
                                <Input
                                  autoFocus
                                  aria-label={`${p.full_name} notu`}
                                  placeholder="Not (ör. yarım gün, geç geldi)"
                                  maxLength={200}
                                  className="h-11 min-w-0 flex-1"
                                  value={editing.text}
                                  onChange={(e) => setEditing({ id: p.id, text: e.target.value })}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                      e.preventDefault();
                                      void onSaveNote();
                                    }
                                  }}
                                />
                                <Button type="button" className="h-11" onClick={onSaveNote} disabled={noteBusy}>
                                  {noteBusy && <Loader2 className="animate-spin" aria-hidden />}
                                  Kaydet
                                </Button>
                                <Button type="button" variant="ghost" className="h-11" onClick={() => setEditing(null)}>
                                  Vazgeç
                                </Button>
                              </div>
                            );
                          }
                          return note ? <p className="border-t bg-muted/30 px-4 py-2 text-xs">Not: {note}</p> : null;
                        })()}
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))
          )}
        </>
      )}

      {excluded.length > 0 && (
        <details className="rounded-xl border bg-card">
          <summary className="flex min-h-12 cursor-pointer items-center px-4 text-sm font-medium">
            {excluded.length} kişi bu tarihte listede yok
          </summary>
          <ul className="divide-y border-t">
            {excluded.map((p) => (
              <li key={p.id} className="flex min-h-11 items-center justify-between gap-3 px-4 py-2 text-sm">
                <span className="truncate">{p.full_name}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{p.reason}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {canWrite ? (
        <StickyActionBar>
          <span className="flex min-w-0 flex-1 flex-col justify-center text-sm leading-tight">
            <span className="font-medium">{count} kişi işaretlendi</span>
            {dirty && <span className="text-xs text-orange-700 dark:text-orange-400">Kaydedilmedi</span>}
          </span>
          <Button type="button" className="h-12 min-w-32 text-base" onClick={onSave} disabled={!dirty || pending}>
            {pending && <Loader2 className="animate-spin" aria-hidden />}
            Kaydet
          </Button>
        </StickyActionBar>
      ) : (
        <p className="text-center text-xs text-muted-foreground">Bu ekranı yalnızca görüntüleyebilirsiniz.</p>
      )}
    </div>
  );
}
