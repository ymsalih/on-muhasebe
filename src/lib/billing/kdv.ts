/**
 * Fatura KDV hesabı (tarayıcıda canlı önizleme ve sunucuda kayıt için TEK kaynak; saf fonksiyonlar).
 *
 * Kayıt biçimi: `amount` = KDV HARİÇ tutar (matrah), `kdv_rate` = oran (%), `kdv_amount` = KDV tutarı;
 * KDV dahil toplam = matrah + KDV (veritabanı otomatik hesaplar).
 *  - "KDV hariç" girilirse : KDV = matrah × oran / 100 (kuruşa yuvarlı), toplam = matrah + KDV.
 *  - "KDV dahil" girilirse : matrah = girilen / (1 + oran/100) (kuruşa yuvarlı), KDV = girilen − matrah,
 *                            böylece toplam girilen tutara KURUŞU KURUŞUNA eşit kalır.
 */
export type KdvMode = "net" | "gross";
export const KDV_MODE_LABELS: Record<KdvMode, string> = { net: "KDV hariç", gross: "KDV dahil" };

/** Hızlı seçim oranları (Türkiye: genel %20, indirimli %10 ve %1; KDV'siz için %0). Başka oran "Diğer" ile girilir (ör. 8, 18). */
export const KDV_PRESETS = [0, 1, 10, 20] as const;

export type KdvResult = { net: number; kdv: number; total: number; rate: number };

export const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

/** "12,5" → 12.5; geçersizse null. En çok 2 ondalık, 0'dan büyük. */
export function parseAmount(v: string): number | null {
  const t = v.trim();
  if (!/^\d{1,12}([.,]\d{1,2})?$/.test(t)) return null;
  const n = Number(t.replace(",", "."));
  return n > 0 ? n : null;
}

/** KDV oranı: boş = %0; 0–100 arası, en çok 2 ondalık; geçersizse null. */
export function parseRate(v: string): number | null {
  const t = v.trim();
  if (t === "") return 0;
  if (!/^\d{1,3}([.,]\d{1,2})?$/.test(t)) return null;
  const n = Number(t.replace(",", "."));
  return n >= 0 && n <= 100 ? n : null;
}

/** Tutar + oran + giriş biçiminden matrah, KDV ve toplamı hesaplar; girdi geçersizse null. */
export function computeKdv(amountText: string, rateText: string, mode: KdvMode): KdvResult | null {
  const entered = parseAmount(amountText);
  const rate = parseRate(rateText);
  if (entered === null || rate === null) return null;
  if (mode === "gross") {
    const net = round2(entered / (1 + rate / 100));
    return { net, kdv: round2(entered - net), total: round2(entered), rate };
  }
  const kdv = round2((entered * rate) / 100);
  return { net: round2(entered), kdv, total: round2(entered + kdv), rate };
}

/** Oranı kısa metne çevirir: 20 → "%20", 7.5 → "%7,5" */
export const rateLabel = (rate: number): string => `%${String(rate).replace(".", ",")}`;
