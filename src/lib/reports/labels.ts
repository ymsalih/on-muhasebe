export const SHORT_MONTHS = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];

/** Trend noktası etiketi: gün → "05.09", ay → "Eyl 2026". (İstemci ve sunucuda ortak kullanılır.) */
export function periodLabel(period: string, bucket: "day" | "month"): string {
  const [y, m, d] = period.split("-");
  return bucket === "day" ? `${d}.${m}` : `${SHORT_MONTHS[Number(m) - 1]} ${y}`;
}
