import { z } from "zod";

export const COMPANY_ENTRY_TYPES = ["income", "expense"] as const;
export type CompanyEntryType = (typeof COMPANY_ENTRY_TYPES)[number];
export const COMPANY_ENTRY_TYPE_LABELS: Record<CompanyEntryType, string> = { income: "Gelir", expense: "Gider" };

export const companyEntrySchema = z.object({
  type: z.enum(COMPANY_ENTRY_TYPES, "Gelir mi gider mi seçin."),
  amount: z
    .string()
    .trim()
    .min(1, "Tutarı girin.")
    .regex(/^\d{1,12}([.,]\d{1,2})?$/, "Geçerli bir tutar girin (en fazla 2 ondalık).")
    .refine((v) => Number(v.replace(",", ".")) > 0, "Tutar 0'dan büyük olmalı."),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Tarih seçin."),
  description: z.string().trim().min(2, "Açıklama en az 2 karakter olmalı.").max(300, "Açıklama en fazla 300 karakter olabilir."),
});
export type CompanyEntryValues = z.infer<typeof companyEntrySchema>;
