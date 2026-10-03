"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { AlertTriangle, Check, CheckCircle2, ChevronLeft, ChevronRight, Loader2, MessageSquarePlus, Search, Undo2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormError } from "@/components/auth/field";
import { StickyActionBar } from "@/components/layout/sticky-action-bar";
import { saveAttendance, setAttendanceNote } from "@/lib/attendance/actions";
import { formatDate } from "@/lib/format";
import { addDays } from "@/lib/personnel/status";
import { useLiveRefresh } from "@/lib/use-live-refresh";
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
 * Günlük Gelenler (CLAUDE.md 7.3-E).
 *
 * Tek gerçek kaynak SUNUCUDUR: işaretli kişiler her zaman `initialPresent` (sunucu verisi) ile belirlenir ve
 * sayfa canlı tazelenir; bu yüzden matristen ya da başka bir sekmeden yapılan işaretler burada da görünür.
 * Bu ekran yalnızca EKLEME yapar: zaten "Geldi" olan kişide seçim kutusu yoktur (rozet gösterilir);
 * işareti kaldırmak (iptal) Aylık Özet matrisinden yapılır. Yerel durum yalnızca kaydedilmemiş yeni seçimlerdir.
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

  // Sunucudan gelen (kaydedilmiş) işaretler
  const meta = useMemo(() => new Map(initialPresent.map((m) => [m.id, m])), [initialPresent]);
  // Yerel: henüz kaydedilmemiş yeni seçimler
  const [picked, setPicked] = useState<Set<number>>(new Set());
  // Az önce kaydedilenler: sunucu verisi tazelenene kadar "Geldi" görünür (kaydet sonrası titreme olmasın).
  const [justSaved, setJustSaved] = useState<Set<number>>(new Set());
  const [justRemoved, setJustRemoved] = useState<Set<number>>(new Set());
  // Bu arada başka yerden işaretlenenler yeni seçimden düşer
  const presentIds = useMemo(
    () => new Set([...meta.keys(), ...justSaved].filter((id) => !justRemoved.has(id))),
    [meta, justSaved, justRemoved],
  );
  const newPicks = useMemo(() => [...picked].filter((id) => !presentIds.has(id)), [picked, presentIds]);
  const dirty = newPicks.length > 0;
  const total = presentIds.size + newPicks.length;

  const [noteEdits, setNoteEdits] = useState<Record<number, string | null>>({});
  const [editing, setEditing] = useState<{ id: number; text: string } | null>(null);
  const [noteBusy, setNoteBusy] = useState(false);
  const [lastSave, setLastSave] = useState<number[] | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [query, setQuery] = useState("");
  const [groupBy, setGroupBy] = useState<"ad" | "gorev">("ad");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();

  useLiveRefresh(!pending && !noteBusy);
  // Sunucu verisi yenilendiğinde yerel not düzeltmeleri gereksizdir (sunucudaki güncel not gelir).
  useEffect(() => setNoteEdits({}), [initialPresent]);
  // Sunucu artık işaretleri içeriyorsa iyimser katmana gerek kalmaz (sonradan kaldırılırsa doğru görünsün).
  useEffect(() => {
    setJustSaved((prev) => {
      const next = new Set([...prev].filter((id) => !meta.has(id)));
      return next.size === prev.size ? prev : next;
    });
    // Sunucu artık bu kişileri içermiyorsa "az önce kaldırıldı" katmanı da gereksizdir.
    setJustRemoved((prev) => {
      const next = new Set([...prev].filter((id) => meta.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [meta]);

  // Kaydedilmemiş yeni seçimle sekme kapatılırsa uyar.
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  function go(next: string) {
    if (next === date || !/^\d{4}-\d{2}-\d{2}$/.test(next) || next > today) return;
    if (dirty && !window.confirm("Kaydedilmemiş seçimler var. Tarihi değiştirirseniz kaybolacak. Devam edilsin mi?")) return;
    router.push(`${pathname}?tarih=${next}`);
  }

  function toggle(id: number) {
    setDone(false);
    setPicked((prev) => {
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

  function selectAllVisible() {
    setDone(false);
    setPicked((prev) => {
      const next = new Set(prev);
      for (const p of visible) if (!presentIds.has(p.id)) next.add(p.id);
      return next;
    });
  }

  function clearVisiblePicks() {
    setPicked((prev) => {
      const next = new Set(prev);
      for (const p of visible) next.delete(p.id);
      return next;
    });
  }

  function onSave() {
    setError(null);
    setDone(false);
    const ids = newPicks;
    startTransition(async () => {
      const res = await saveAttendance({ siteId, date, add: ids, remove: [] }).catch(() => null);
      if (!res) return setError("Puantaj kaydedilemedi, bağlantınızı kontrol edip tekrar deneyin.");
      if (!res.ok) return setError(res.error);
      setPicked(new Set());
      setJustSaved((prev) => new Set([...prev, ...ids]));
      setDone(true);
      setLastSave(ids);
      if (undoTimer.current) clearTimeout(undoTimer.current);
      undoTimer.current = setTimeout(() => setLastSave(null), UNDO_MS);
      router.refresh();
    });
  }

  /** Son kaydı geri alır: yeni eklenenlerin işaretini kaldırır. */
  function onUndo() {
    if (!lastSave) return;
    const ids = lastSave;
    setError(null);
    startTransition(async () => {
      const res = await saveAttendance({ siteId, date, add: [], remove: ids }).catch(() => null);
      if (!res) return setError("Geri alınamadı, bağlantınızı kontrol edip tekrar deneyin.");
      if (!res.ok) return setError(res.error);
      setJustSaved((prev) => new Set([...prev].filter((id) => !ids.includes(id))));
      setJustRemoved((prev) => new Set([...prev, ...ids]));
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
        {isToday ? " (bugün)" : ""} · {total} kişi işaretli
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
                <Button type="button" variant="outline" className="h-11" onClick={selectAllVisible}>
                  Kalanları işaretle
                </Button>
                <Button type="button" variant="ghost" className="h-11" onClick={clearVisiblePicks} disabled={!dirty}>
                  Seçimi temizle
                </Button>
              </>
            )}
          </div>

          {presentIds.size > 0 && (
            <p className="flex flex-wrap items-center gap-x-1 text-xs text-muted-foreground">
              <span>“Geldi” işaretli kişilerin işaretini kaldırmak için</span>
              <Link href={`/sites/${siteId}/puantaj?gorunum=aylik`} className="inline-flex min-h-11 items-center font-medium text-primary underline-offset-4 hover:underline">
                Aylık Özet’i kullanın.
              </Link>
            </p>
          )}

          {visible.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Aramanıza uyan personel yok.</p>
          ) : (
            groups.map(({ title, rows }) => (
              <section key={title ?? "hepsi"} className="overflow-hidden rounded-xl border bg-card">
                {title && (
                  <h2 className="flex items-center justify-between border-b bg-muted/50 px-4 py-2 text-sm font-semibold">
                    {title}
                    <span className="font-normal text-muted-foreground">
                      {rows.filter((r) => presentIds.has(r.id) || picked.has(r.id)).length}/{rows.length}
                    </span>
                  </h2>
                )}
                <ul className="divide-y">
                  {rows.map((p) => {
                    const m = meta.get(p.id);
                    const isPresent = presentIds.has(p.id);
                    const isPicked = !isPresent && picked.has(p.id);
                    const note = p.id in noteEdits ? noteEdits[p.id] : m?.note;

                    const details = (
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{p.full_name}</span>
                        {(p.job || p.duty) && (
                          <span className="block truncate text-xs text-muted-foreground">{[p.job, p.duty].filter(Boolean).join(" · ")}</span>
                        )}
                        {isPresent && (
                          <span className="block truncate text-xs text-muted-foreground">
                            {m ? `${m.markedBy ?? "Bilinmiyor"} işaretledi · ${timeFmt(m.markedAt)}` : "Az önce işaretlendi"}
                          </span>
                        )}
                        {p.warning && (
                          <span className="mt-0.5 flex items-center gap-1 text-xs text-orange-700 dark:text-orange-400">
                            <AlertTriangle className="size-3 shrink-0" aria-hidden />
                            Bu tarihte {p.warning.toLocaleLowerCase("tr-TR")} görünüyor
                          </span>
                        )}
                      </span>
                    );

                    return (
                      <li key={p.id}>
                        <div className={cn("flex items-stretch", (isPresent || isPicked) && "bg-emerald-50 dark:bg-emerald-950/30")}>
                          {isPresent ? (
                            // Zaten işaretli: seçim kutusu yok, rozet var (iptal Aylık Özet'ten yapılır).
                            <div className="flex min-h-14 min-w-0 flex-1 items-center gap-3 px-4 py-2">
                              <span
                                role="img"
                                aria-label="Geldi"
                                className="flex size-7 shrink-0 items-center justify-center rounded-full bg-emerald-700 text-white"
                              >
                                <Check className="size-4" aria-hidden />
                              </span>
                              {details}
                              <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                                Geldi
                              </span>
                            </div>
                          ) : (
                            <label className={cn("flex min-h-14 min-w-0 flex-1 items-center gap-3 px-4 py-2", canWrite ? "cursor-pointer hover:bg-muted/40" : "cursor-default")}>
                              <input
                                type="checkbox"
                                checked={isPicked}
                                disabled={!canWrite || pending}
                                onChange={() => toggle(p.id)}
                                className="size-7 shrink-0 accent-emerald-600"
                              />
                              {details}
                            </label>
                          )}
                          {canWrite && isPresent && (
                            <button
                              type="button"
                              aria-label={`${p.full_name} için not ekle veya düzenle`}
                              onClick={() => setEditing({ id: p.id, text: note ?? "" })}
                              className="flex min-h-14 w-12 shrink-0 items-center justify-center text-muted-foreground hover:bg-muted/40 hover:text-foreground"
                            >
                              <MessageSquarePlus className="size-5" aria-hidden />
                            </button>
                          )}
                        </div>
                        {editing?.id === p.id ? (
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
                        ) : (
                          note && <p className="border-t bg-muted/30 px-4 py-2 text-xs">Not: {note}</p>
                        )}
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
            <span className="font-medium">{total} kişi işaretli</span>
            {dirty && <span className="text-xs text-orange-700 dark:text-orange-400">{newPicks.length} yeni seçim kaydedilmedi</span>}
          </span>
          <Button type="button" className="h-12 min-w-32 text-base" onClick={onSave} disabled={!dirty || pending}>
            {pending && <Loader2 className="animate-spin" aria-hidden />}
            {dirty ? `Kaydet (${newPicks.length})` : "Kaydet"}
          </Button>
        </StickyActionBar>
      ) : (
        <p className="text-center text-xs text-muted-foreground">Bu ekranı yalnızca görüntüleyebilirsiniz.</p>
      )}
    </div>
  );
}
