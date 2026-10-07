import { z } from "zod";

export const CHEQUE_DIRECTIONS = ["received", "given"] as const;
export type ChequeDirection = (typeof CHEQUE_DIRECTIONS)[number];
/** Alınan = bir müşteriden/cariden alınan, tahsil edilecek çek. Verilen = birine verilen, ödenecek çek. */
export const CHEQUE_DIRECTION_LABELS: Record<ChequeDirection, string> = { received: "Alınan çek", given: "Verilen çek" };
export const CHEQUE_PARTY_LABELS: Record<ChequeDirection, string> = { received: "Kimden alındı", given: "Kime verildi" };

export const CHEQUE_STATUSES = ["pending", "settled", "bounced", "cancelled"] as const;
export type ChequeStatus = (typeof CHEQUE_STATUSES)[number];
export function chequeStatusLabel(status: ChequeStatus, direction: ChequeDirection): string {
  switch (status) {
    case "pending":
      return "Bekliyor";
    case "settled":
      return direction === "received" ? "Tahsil edildi" : "Ödendi";
    case "bounced":
      return "Karşılıksız";
    case "cancelled":
      return "İptal";
  }
}

/** Uyarı penceresi: vadesi bugünden bu kadar gün içinde olan (ve vadesi geçmiş) bekleyen çekler uyarı olarak gösterilir. */
export const ALERT_DAYS = 7;

const money = z
  .string()
  .trim()
  .min(1, "Tutarı girin.")
  .regex(/^\d{1,12}([.,]\d{1,2})?$/, "Geçerli bir tutar girin (en fazla 2 ondalık).")
  .refine((v) => Number(v.replace(",", ".")) > 0, "Tutar 0'dan büyük olmalı.");
const isoDate = (msg: string) => z.string().regex(/^\d{4}-\d{2}-\d{2}$/, msg);
const optionalDate = z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Geçerli bir tarih seçin.")]);

/** Çek: yön, karşı taraf (kimden/kime), tutar, vade (ödeme) tarihi ve isteğe bağlı çek bilgileri. */
export const chequeSchema = z
  .object({
    direction: z.enum(CHEQUE_DIRECTIONS, "Alınan mı verilen mi seçin."),
    counterparty: z.string().trim().min(2, "Kimden alındığını / kime verildiğini yazın (en az 2 karakter).").max(150, "En fazla 150 karakter olabilir."),
    amount: money,
    dueDate: isoDate("Vade (ödeme) tarihini seçin."),
    issueDate: optionalDate,
    chequeNo: z.string().trim().max(50, "Çek no en fazla 50 karakter olabilir."),
    bank: z.string().trim().max(100, "Banka en fazla 100 karakter olabilir."),
    note: z.string().trim().max(300, "Not en fazla 300 karakter olabilir."),
    status: z.enum(CHEQUE_STATUSES, "Durumu seçin."),
    settledDate: optionalDate,
  })
  .superRefine((v, ctx) => {
    if (v.issueDate && v.issueDate > v.dueDate) {
      ctx.addIssue({ code: "custom", path: ["issueDate"], message: "Düzenleme tarihi vade tarihinden sonra olamaz." });
    }
  });
export type ChequeValues = z.infer<typeof chequeSchema>;

/** "12,5" → 12.5 */
export const num = (v: string): number => Number(v.trim().replace(",", "."));

/** Bugünden vadeye kalan gün (negatif = vadesi geçmiş). İki ISO tarih arasındaki takvim günü farkıdır. */
export function daysUntil(due: string, today: string): number {
  return Math.round((Date.parse(`${due}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000);
}

/** "Bugün", "Yarın", "3 gün kaldı", "2 gün gecikti" */
export function dueText(daysLeft: number): string {
  if (daysLeft === 0) return "Bugün";
  if (daysLeft === 1) return "Yarın";
  if (daysLeft > 1) return `${daysLeft} gün kaldı`;
  return `${Math.abs(daysLeft)} gün gecikti`;
}
