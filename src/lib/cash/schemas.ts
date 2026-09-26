import { z } from "zod";
import { PAYMENT_METHODS } from "@/lib/parties/schemas";

export const CASH_TYPES = ["income", "expense"] as const;
export type CashType = (typeof CASH_TYPES)[number];
export const CASH_TYPE_LABELS: Record<CashType, string> = { income: "Gelir", expense: "Gider" };

/** Genel kasa hareketi (gelir/gider). Cari detayında aynı form "Tahsilat/Ödeme" etiketleriyle kullanılır. */
export const cashTransactionSchema = z.object({
  type: z.enum(CASH_TYPES, "Gelir mi gider mi seçin."),
  amount: z
    .string()
    .trim()
    .min(1, "Tutarı girin.")
    .regex(/^\d{1,12}([.,]\d{1,2})?$/, "Geçerli bir tutar girin (en fazla 2 ondalık).")
    .refine((v) => Number(v.replace(",", ".")) > 0, "Tutar 0'dan büyük olmalı."),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Tarih seçin."),
  description: z.string().trim().min(2, "Açıklama en az 2 karakter olmalı.").max(300, "Açıklama en fazla 300 karakter olabilir."),
  categoryId: z.string().regex(/^\d*$/, "Geçersiz kategori."),
  partyId: z.string().regex(/^\d*$/, "Geçersiz cari."),
  paymentMethod: z.union([z.literal(""), z.enum(PAYMENT_METHODS)]),
});
export type CashTransactionValues = z.infer<typeof cashTransactionSchema>;

export const categoryNameSchema = z.string().trim().min(2, "Kategori adı en az 2 karakter olmalı.").max(80, "Kategori adı en fazla 80 karakter olabilir.");
export const createCategorySchema = z.object({
  siteId: z.number().int().positive(),
  name: categoryNameSchema,
  type: z.enum(CASH_TYPES),
});
