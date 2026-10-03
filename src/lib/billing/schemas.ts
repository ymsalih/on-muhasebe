import { z } from "zod";

export const INVOICE_TYPES = ["malzeme", "nakliyat", "yakit", "iscilik", "kira", "diger"] as const;
export type InvoiceType = (typeof INVOICE_TYPES)[number];
export const INVOICE_TYPE_LABELS: Record<InvoiceType, string> = {
  malzeme: "Malzeme",
  nakliyat: "Nakliyat",
  yakit: "Yakıt",
  iscilik: "İşçilik",
  kira: "Kira (araç / ekipman)",
  diger: "Diğer",
};

const amount = z
  .string()
  .trim()
  .min(1, "Tutarı girin.")
  .regex(/^\d{1,12}([.,]\d{1,2})?$/, "Geçerli bir tutar girin (en fazla 2 ondalık).")
  .refine((v) => Number(v.replace(",", ".")) > 0, "Tutar 0'dan büyük olmalı.");
const isoDate = (msg: string) => z.string().regex(/^\d{4}-\d{2}-\d{2}$/, msg);

/** Hakediş: alınan hakediş tutarı. Toplam hakedişe yansır. */
export const progressPaymentSchema = z.object({
  date: isoDate("Hakediş tarihini seçin."),
  description: z.string().trim().max(300, "Açıklama en fazla 300 karakter olabilir."),
  amount,
});
export type ProgressPaymentValues = z.infer<typeof progressPaymentSchema>;

/** Kesilen fatura: türü (neye kesildi), açıklaması ve tutarı. Toplam faturaya yansır. */
export const invoiceSchema = z.object({
  date: isoDate("Fatura tarihini seçin."),
  invoiceNo: z.string().trim().max(50, "Fatura no en fazla 50 karakter olabilir."),
  type: z.enum(INVOICE_TYPES, "Fatura türünü seçin."),
  description: z.string().trim().min(2, "Açıklama en az 2 karakter olmalı.").max(300, "Açıklama en fazla 300 karakter olabilir."),
  amount,
});
export type InvoiceValues = z.infer<typeof invoiceSchema>;

/** "12,5" → 12.5 */
export const num = (v: string): number => Number(v.trim().replace(",", "."));

/** Eklenmesi gereken fatura = toplam hakediş − toplam fatura (kuruşa yuvarlı). Negatif = fatura hakedişi aşıyor. */
export const remainingInvoice = (progressTotal: number, invoiceTotal: number): number => Math.round((progressTotal - invoiceTotal) * 100) / 100;
