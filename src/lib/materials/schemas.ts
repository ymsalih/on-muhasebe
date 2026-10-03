import { z } from "zod";

const money = (label: string) =>
  z.string().trim().regex(/^\d{1,12}([.,]\d{1,2})?$/, `${label} geçerli bir sayı olmalı (en fazla 2 ondalık).`);

/** Malzeme girişi: alınan malzeme + fiyatı. Maliyet (miktar × birim fiyat) sunucuda/veritabanında hesaplanır. */
export const materialEntrySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Tarih seçin."),
  name: z.string().trim().min(2, "Malzeme adı en az 2 karakter olmalı.").max(150, "Malzeme adı çok uzun."),
  unit: z.string().trim().min(1, "Birim girin (ör. adet, kg, torba).").max(30, "Birim en fazla 30 karakter olabilir."),
  quantity: money("Miktar").refine((v) => Number(v.replace(",", ".")) > 0, "Miktar 0'dan büyük olmalı."),
  unitPrice: z.string().trim().min(1, "Birim fiyatı girin.").pipe(money("Birim fiyat")),
  supplier: z.string().trim().max(150, "Kimden alındı en fazla 150 karakter olabilir."),
  usedFor: z.string().trim().max(300, "Kullanım yeri en fazla 300 karakter olabilir."),
  note: z.string().trim().max(500, "Not en fazla 500 karakter olabilir."),
});
export type MaterialEntryValues = z.infer<typeof materialEntrySchema>;

export const BREAKDOWNS = ["partner", "item", "usage"] as const;
export type Breakdown = (typeof BREAKDOWNS)[number];

/** "12,5" → 12.5 */
export const num = (v: string): number => Number(v.trim().replace(",", "."));

/** Miktar × birim fiyat, kuruşa yuvarlı (veritabanı sütunuyla aynı formül). */
export const lineTotal = (qty: number, price: number): number => Math.round(qty * price * 100) / 100;
