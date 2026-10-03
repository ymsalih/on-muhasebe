import { formatCurrency } from "@/lib/format";
import { RATE_UNIT_LABELS, type Ownership, type RateUnit } from "@/lib/machines/schemas";

/** Kısa sahiplik/kira özeti: "Kiralık · Yılmaz İnşaat · Günlük ₺5.000,00". Sunucu ve istemci bileşenlerinde ortak kullanılır. */
export function machineSubtitle(m: { ownership: Ownership; supplier: string | null; rate_unit: RateUnit | null; rental_rate: number | null }): string {
  return [
    m.ownership === "rented" ? "Kiralık" : "Kendi makinem",
    m.ownership === "rented" && m.supplier,
    m.rate_unit && m.rental_rate !== null && `${RATE_UNIT_LABELS[m.rate_unit]} ${formatCurrency(m.rental_rate)}`,
  ]
    .filter(Boolean)
    .join(" · ");
}
