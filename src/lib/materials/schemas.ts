import { z } from "zod";

export const MOVEMENT_TYPES = ["in", "out"] as const;
export type MovementType = (typeof MOVEMENT_TYPES)[number];
export const MOVEMENT_TYPE_LABELS: Record<MovementType, string> = { in: "Giriş", out: "Çıkış" };

const decimal = (label: string) =>
  z.string().trim().regex(/^\d{1,12}([.,]\d{1,2})?$/, `${label} geçerli bir sayı olmalı (en fazla 2 ondalık).`);

export const materialSchema = z.object({
  name: z.string().trim().min(2, "Malzeme adı en az 2 karakter olmalı.").max(150, "Malzeme adı çok uzun."),
  variant: z.string().trim().max(150, "Cins en fazla 150 karakter olabilir."),
  unit: z.string().trim().min(1, "Birim girin (ör. adet, kg, torba).").max(30, "Birim en fazla 30 karakter olabilir."),
});
export type MaterialValues = z.infer<typeof materialSchema>;

export const movementSchema = z
  .object({
    materialId: z.string().regex(/^\d+$/, "Malzeme seçin."),
    type: z.enum(MOVEMENT_TYPES, "Giriş mi çıkış mı seçin."),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Tarih seçin."),
    quantity: decimal("Miktar").refine((v) => Number(v.replace(",", ".")) > 0, "Miktar 0'dan büyük olmalı."),
    /** Yalnızca girişte (alış fiyatı); çıkışta yok sayılır. Boş = fiyat bilinmiyor. */
    unitPrice: z.string().trim().refine((v) => v === "" || /^\d{1,12}([.,]\d{1,2})?$/.test(v), "Birim fiyat geçerli bir tutar olmalı (en fazla 2 ondalık)."),
    counterparty: z.string().trim().max(150, "Kimden/kime en fazla 150 karakter olabilir."),
    note: z.string().trim().max(500, "Not en fazla 500 karakter olabilir."),
  });
export type MovementValues = z.infer<typeof movementSchema>;

/** "12,5" → 12.5 */
export const num = (v: string): number => Number(v.trim().replace(",", "."));
