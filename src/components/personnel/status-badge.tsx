import { cn } from "@/lib/utils";
import { PERSON_STATUS_LABELS, type PersonStatus } from "@/lib/personnel/schemas";

const TONES: Record<PersonStatus, string> = {
  aktif: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400",
  izinli: "bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-400",
  raporlu: "bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-400",
  gecici_gorevde: "bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-400",
  ayrildi: "bg-muted text-muted-foreground",
};

/** Durum rozeti (7.3-H): Aktif / İzinli / Raporlu / Geçici Görevde / Ayrıldı. */
export function StatusBadge({ status }: { status: PersonStatus }) {
  return (
    <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium", TONES[status])}>
      {PERSON_STATUS_LABELS[status]}
    </span>
  );
}
