import { z } from "zod";
import { PAYMENT_METHODS } from "@/lib/parties/schemas";

export const MONTH_NAMES = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];

/** "2026-05" → "Mayıs 2026" */
export function monthLabel(month: string): string {
  const [y, m] = month.split("-");
  return `${MONTH_NAMES[Number(m) - 1] ?? m} ${y}`;
}

/** Maaş ödemesi = gün × günlük tutar (CLAUDE.md Faz 8). Tutar sunucuda hesaplanır; istemciden alınmaz. */
export const personPaymentSchema = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Hakediş ayını seçin."),
  workDays: z.string().trim().regex(/^\d{1,2}$/, "Gün sayısı 1–31 arasında tam sayı olmalı.").refine((v) => Number(v) >= 1 && Number(v) <= 31, "Gün sayısı 1–31 arasında olmalı."),
  dailyRate: z
    .string()
    .trim()
    .regex(/^\d{1,10}([.,]\d{1,2})?$/, "Günlük tutarı girin (en fazla 2 ondalık).")
    .refine((v) => Number(v.replace(",", ".")) > 0, "Günlük tutar 0'dan büyük olmalı."),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Ödeme tarihini seçin."),
  paymentMethod: z.union([z.literal(""), z.enum(PAYMENT_METHODS)]),
});
export type PersonPaymentValues = z.infer<typeof personPaymentSchema>;

/** gün × günlük tutar, kuruşa yuvarlı (veritabanı CHECK'i ile aynı formül). */
export function wageTotal(days: number, rate: number): number {
  return Math.round(days * rate * 100) / 100;
}
