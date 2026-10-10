import { z } from "zod";
import { PARTY_CATEGORIES } from "@/lib/goods/schemas";

export const partySchema = z.object({
  name: z.string().trim().min(2, "Ad en az 2 karakter olmalı.").max(150, "Ad en fazla 150 karakter olabilir."),
  category: z.enum(PARTY_CATEGORIES, "Kategori seçin."),
  phone: z
    .string()
    .trim()
    .max(30, "Telefon en fazla 30 karakter olabilir.")
    .regex(/^[0-9+()\s-]*$/, "Telefon yalnızca rakam ve + ( ) - içerebilir."),
  address: z.string().trim().max(500, "Adres en fazla 500 karakter olabilir."),
  notes: z.string().trim().max(1000, "Not en fazla 1000 karakter olabilir."),
});
export type PartyValues = z.infer<typeof partySchema>;

/** Ödeme = gider (expense), Tahsilat = gelir (income). */
export const TX_KINDS = ["odeme", "tahsilat"] as const;
export type TxKind = (typeof TX_KINDS)[number];
export const TX_KIND_LABELS: Record<TxKind, string> = { odeme: "Ödeme", tahsilat: "Tahsilat" };
export const typeToKind = (t: "income" | "expense"): TxKind => (t === "income" ? "tahsilat" : "odeme");

export const PAYMENT_METHODS = ["nakit", "havale", "cek", "diger"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  nakit: "Nakit",
  havale: "Havale / EFT",
  cek: "Çek",
  diger: "Diğer",
};

/** Cariye borç yazma ("çelikçiye 100.000 ₺ borcum var"): tutar, tarih ve isteğe bağlı açıklama. */
export const debtSchema = z.object({
  amount: z
    .string()
    .trim()
    .min(1, "Borç tutarını girin.")
    .regex(/^\d{1,12}([.,]\d{1,2})?$/, "Geçerli bir tutar girin (en fazla 2 ondalık).")
    .refine((v) => Number(v.replace(",", ".")) > 0, "Tutar 0'dan büyük olmalı."),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Borç tarihini seçin."),
  description: z.string().trim().max(300, "Açıklama en fazla 300 karakter olabilir."),
});
export type DebtValues = z.infer<typeof debtSchema>;
