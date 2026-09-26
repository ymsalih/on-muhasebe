import { z } from "zod";

export const DOCUMENT_TYPES = ["irsaliye", "fatura", "fis"] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];
export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  irsaliye: "İrsaliye",
  fatura: "Fatura",
  fis: "Fiş",
};

export const PARTY_CATEGORIES = ["firma", "nakliyeci", "arac", "musteri", "diger"] as const;
export type PartyCategory = (typeof PARTY_CATEGORIES)[number];
export const PARTY_CATEGORY_LABELS: Record<PartyCategory, string> = {
  firma: "Firma",
  nakliyeci: "Nakliyeci",
  arac: "Araç",
  musteri: "Müşteri",
  diger: "Diğer",
};

/** Birim alanı serbest metindir; bunlar yalnızca öneri olarak sunulur. */
export const COMMON_UNITS = ["adet", "kg", "ton", "m", "m²", "m³", "lt", "torba", "paket", "sefer", "gün", "saat"];

/** "12,5" veya "12.5"; en fazla 2 ondalık. Boş kabul edilir. */
const decimalField = (label: string) =>
  z
    .string()
    .trim()
    .refine((v) => v === "" || /^\d{1,12}([.,]\d{1,2})?$/.test(v), `${label} geçerli bir sayı olmalı (en fazla 2 ondalık).`);

/**
 * Form değerleri metin olarak tutulur (input değerleri); sayıya çevirme `toDbNumber` ile sunucuda yapılır.
 * Zorunlu alanlar yalnızca şemadaki NOT NULL olanlardır: tarih ve belge türü.
 */
export const goodsEntrySchema = z.object({
  entryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Tarih seçin."),
  documentType: z.enum(DOCUMENT_TYPES, "Belge türünü seçin."),
  documentNo: z.string().trim().max(50, "Belge no en fazla 50 karakter olabilir."),
  partyId: z.string().regex(/^\d*$/, "Geçersiz firma."),
  materialType: z.string().trim().max(150, "Malzeme türü en fazla 150 karakter olabilir."),
  unit: z.string().trim().max(30, "Birim en fazla 30 karakter olabilir."),
  variant: z.string().trim().max(150, "Çeşit en fazla 150 karakter olabilir."),
  quantity: decimalField("Miktar"),
  usedLocation: z.string().trim().max(150, "Kullanıldığı yer en fazla 150 karakter olabilir."),
  purchaseLocation: z.string().trim().max(150, "Satın alma yeri en fazla 150 karakter olabilir."),
  transportCost: decimalField("Nakliye tutarı"),
  info: z.string().trim().max(2000, "Not en fazla 2000 karakter olabilir."),
});
export type GoodsEntryValues = z.infer<typeof goodsEntrySchema>;

export const createPartySchema = z.object({
  siteId: z.number().int().positive(),
  name: z.string().trim().min(2, "Firma adı en az 2 karakter olmalı.").max(150, "Firma adı çok uzun."),
  category: z.enum(PARTY_CATEGORIES, "Kategori seçin."),
});

/** "" → null, "12,5" → 12.5 */
export function toDbNumber(value: string): number | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : Number(trimmed.replace(",", "."));
}
