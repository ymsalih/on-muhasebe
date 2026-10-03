import { z } from "zod";
import { PAYMENT_METHODS } from "@/lib/parties/schemas";

export const MACHINE_TYPES = ["kepce", "ekskavator", "dozer", "greyder", "silindir", "vinc", "kamyon", "beton_pompasi", "diger"] as const;
export type MachineType = (typeof MACHINE_TYPES)[number];
export const MACHINE_TYPE_LABELS: Record<MachineType, string> = {
  kepce: "Kepçe",
  ekskavator: "Ekskavatör",
  dozer: "Dozer",
  greyder: "Greyder",
  silindir: "Silindir",
  vinc: "Vinç",
  kamyon: "Kamyon",
  beton_pompasi: "Beton pompası",
  diger: "Diğer",
};

export const OWNERSHIPS = ["own", "rented"] as const;
export type Ownership = (typeof OWNERSHIPS)[number];
export const OWNERSHIP_LABELS: Record<Ownership, string> = { own: "Kendi makinem", rented: "Kiralık" };

export const RATE_UNITS = ["day", "hour"] as const;
export type RateUnit = (typeof RATE_UNITS)[number];
export const RATE_UNIT_LABELS: Record<RateUnit, string> = { day: "Günlük", hour: "Saatlik" };
/** "5 gün × ₺5.000" gibi metinlerde birim adı */
export const RATE_UNIT_NOUN: Record<RateUnit, string> = { day: "gün", hour: "saat" };

export const MACHINE_STATUSES = ["active", "maintenance", "left"] as const;
export type MachineStatus = (typeof MACHINE_STATUSES)[number];
export const MACHINE_STATUS_LABELS: Record<MachineStatus, string> = { active: "Aktif", maintenance: "Bakımda / arızalı", left: "Şantiyeden ayrıldı" };

const optionalDate = z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Geçerli bir tarih seçin.")]);
const money = z.string().trim().refine((v) => v === "" || /^\d{1,10}([.,]\d{1,2})?$/.test(v), "Tutar geçerli olmalı (en fazla 2 ondalık).");

/** Makine kartı. Kira ücreti yalnızca kiralık makinede; birim ve tutar birlikte girilir. */
export const machineSchema = z
  .object({
    name: z.string().trim().min(2, "Makine adı en az 2 karakter olmalı.").max(150, "Makine adı çok uzun."),
    machineType: z.enum(MACHINE_TYPES, "Makine türünü seçin."),
    identifier: z.string().trim().max(50, "Plaka / seri no en fazla 50 karakter olabilir."),
    ownership: z.enum(OWNERSHIPS, "Kendi mi kiralık mı seçin."),
    supplier: z.string().trim().max(150, "Kiralayan firma en fazla 150 karakter olabilir."),
    rateUnit: z.union([z.literal(""), z.enum(RATE_UNITS)]),
    rentalRate: money,
    status: z.enum(MACHINE_STATUSES, "Durumu seçin."),
    startDate: optionalDate,
    endDate: optionalDate,
  })
  .superRefine((v, ctx) => {
    if (v.ownership === "own" && (v.rateUnit !== "" || v.rentalRate !== "")) {
      ctx.addIssue({ code: "custom", path: ["rentalRate"], message: "Kira ücreti yalnızca kiralık makinede girilir." });
    }
    if (v.ownership === "rented" && (v.rateUnit === "") !== (v.rentalRate === "")) {
      ctx.addIssue({ code: "custom", path: ["rentalRate"], message: "Kira birimi (günlük/saatlik) ve tutarı birlikte girilmeli." });
    }
    if (v.startDate && v.endDate && v.endDate < v.startDate) {
      ctx.addIssue({ code: "custom", path: ["endDate"], message: "Ayrılış tarihi başlangıçtan önce olamaz." });
    }
  });
export type MachineValues = z.infer<typeof machineSchema>;

/** O günün isteğe bağlı çalışma saati ve notu. */
export const machineDaySchema = z.object({
  hours: z
    .string()
    .trim()
    .refine((v) => v === "" || (/^\d{1,2}([.,]\d)?$/.test(v) && Number(v.replace(",", ".")) > 0 && Number(v.replace(",", ".")) <= 24), "Saat 0 ile 24 arasında olmalı (en çok 1 ondalık)."),
  note: z.string().trim().max(300, "Not en fazla 300 karakter olabilir."),
});
export type MachineDayValues = z.infer<typeof machineDaySchema>;

/** Kira ödemesi = miktar (gün veya saat) × birim kira. Tutar sunucuda hesaplanır; istemciden alınmaz. */
export const machineRentalSchema = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Kira ayını seçin."),
  qty: z
    .string()
    .trim()
    .regex(/^\d{1,3}([.,]\d)?$/, "Miktar geçerli olmalı (en çok 1 ondalık).")
    .refine((v) => Number(v.replace(",", ".")) > 0 && Number(v.replace(",", ".")) <= 744, "Miktar 0'dan büyük, en çok 744 olmalı."),
  rate: z
    .string()
    .trim()
    .regex(/^\d{1,10}([.,]\d{1,2})?$/, "Birim kirayı girin (en fazla 2 ondalık).")
    .refine((v) => Number(v.replace(",", ".")) > 0, "Birim kira 0'dan büyük olmalı."),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Ödeme tarihini seçin."),
  paymentMethod: z.union([z.literal(""), z.enum(PAYMENT_METHODS)]),
  sourceIncomeId: z.string().regex(/^\d*$/, "Geçersiz gelir."),
});
export type MachineRentalValues = z.infer<typeof machineRentalSchema>;

/** miktar × birim kira, kuruşa yuvarlı (veritabanı CHECK'i ile aynı formül). */
export const rentalTotal = (qty: number, rate: number): number => Math.round(qty * rate * 100) / 100;

export type MachineLike = { status: MachineStatus; start_date: string | null; end_date: string | null };

/** Makine o gün çalışabilir mi? Yalnızca başlangıç/ayrılış tarihine bakılır (durum bilgi amaçlıdır; geçmiş günler engellenmez). */
export function machineWorkable(m: MachineLike, date: string): { workable: boolean; reason: string | null } {
  if (m.start_date && date < m.start_date) return { workable: false, reason: "Henüz şantiyede değildi" };
  if (m.end_date && date > m.end_date) return { workable: false, reason: "Şantiyeden ayrılmıştı" };
  return { workable: true, reason: null };
}

/** "8,5" → 8.5 */
export const num = (v: string): number => Number(v.trim().replace(",", "."));
