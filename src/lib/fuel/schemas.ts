import { z } from "zod";

export const FUEL_TYPES = ["motorin", "benzin", "lpg", "diger"] as const;
export type FuelType = (typeof FUEL_TYPES)[number];
export const FUEL_TYPE_LABELS: Record<FuelType, string> = { motorin: "Motorin", benzin: "Benzin", lpg: "LPG", diger: "Diğer" };

/** Litre en çok 2, litre fiyatı en çok 2 ondalıklıdır (veritabanı NUMERIC(10,2) / NUMERIC(14,2)). */
const decimal = (label: string, intDigits: number) =>
  z.string().trim().regex(new RegExp(`^\\d{1,${intDigits}}([.,]\\d{1,2})?$`), `${label} geçerli bir sayı olmalı (en fazla 2 ondalık).`);

/** Yakıt kaydı: hangi araç, ne zaman, kim aldı, kaç litre, litre fiyatı. Toplam tutar (litre × litre fiyatı) veritabanında hesaplanır. */
export const fuelEntrySchema = z.object({
  machineId: z.string().regex(/^\d+$/, "Aracı seçin."),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Tarih seçin."),
  fuelType: z.enum(FUEL_TYPES, "Yakıt türünü seçin."),
  liters: decimal("Litre", 8).refine((v) => Number(v.replace(",", ".")) > 0, "Litre 0'dan büyük olmalı."),
  unitPrice: z.string().trim().min(1, "Litre fiyatını girin.").pipe(decimal("Litre fiyatı", 10)),
  fueledBy: z.string().trim().max(150, "Yakıtı alan kişi en fazla 150 karakter olabilir."),
  station: z.string().trim().max(150, "İstasyon en fazla 150 karakter olabilir."),
  note: z.string().trim().max(300, "Not en fazla 300 karakter olabilir."),
});
export type FuelEntryValues = z.infer<typeof fuelEntrySchema>;

/** litre × litre fiyatı, kuruşa yuvarlı (veritabanındaki ROUND(liters * unit_price, 2) ile aynı formül). */
export const fuelTotal = (liters: number, unitPrice: number): number => Math.round(liters * unitPrice * 100) / 100;

/** "8,5" → 8.5 */
export const num = (v: string): number => Number(v.trim().replace(",", "."));
