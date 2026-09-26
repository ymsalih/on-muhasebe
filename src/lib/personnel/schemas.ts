import { z } from "zod";

export const PERSON_STATUSES = ["aktif", "izinli", "raporlu", "gecici_gorevde", "ayrildi"] as const;
export type PersonStatus = (typeof PERSON_STATUSES)[number];
export const PERSON_STATUS_LABELS: Record<PersonStatus, string> = {
  aktif: "Aktif",
  izinli: "İzinli",
  raporlu: "Raporlu",
  gecici_gorevde: "Geçici Görevde",
  ayrildi: "Ayrıldı",
};

/**
 * Elle seçilen "çalışma durumu": yalnızca Aktif veya Ayrıldı. İzinli / Raporlu / Geçici Görevde durumu
 * izin, rapor ve geçici görev TARİHLERİNDEN otomatik türetilir (bkz. lib/personnel/status.ts).
 */
export const BASE_STATUSES = ["aktif", "ayrildi"] as const;

/** "TR33 0006 …" → "TR330006…" (boşluk temizlenir, büyük harf). */
export function normalizeIban(raw: string): string {
  return raw.replace(/\s+/g, "").toUpperCase();
}

/** IBAN biçimi + ülke uzunluğu (TR: 26) + mod-97 sağlama toplamı. */
export function isValidIban(raw: string): boolean {
  const iban = normalizeIban(raw);
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$/.test(iban)) return false;
  if (iban.startsWith("TR") && iban.length !== 26) return false;
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  const digits = rearranged.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let remainder = 0;
  for (const ch of digits) remainder = (remainder * 10 + Number(ch)) % 97;
  return remainder === 1;
}

/** Ekranda okunabilirlik için 4'lü gruplar. */
export function formatIban(iban: string): string {
  return normalizeIban(iban).replace(/(.{4})/g, "$1 ").trim();
}

/** 11 hane, 0 ile başlamaz. (Sağlama algoritması uygulanmaz: yabancı kimlik numaraları farklı kurala tabidir.) */
export const TC_NO_PATTERN = /^[1-9][0-9]{10}$/;

const optionalDate = z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Geçerli bir tarih seçin.")]);

/**
 * Form değerleri metin olarak tutulur. Hassas alanlar (tcNo, iban) için `...Changed` bayrağı vardır:
 * false ise değer hiç gönderilmez/değiştirilmez (mevcut değer sunucuda kalır ve arayüze ASLA geri gönderilmez).
 */
export const personnelSchema = z
  .object({
    fullName: z.string().trim().min(2, "Ad soyad en az 2 karakter olmalı.").max(150, "Ad soyad çok uzun."),
    tcNo: z.string().trim(),
    tcNoChanged: z.boolean(),
    employerPartyId: z.string().regex(/^\d*$/, "Geçersiz firma."),
    insuranceCompany: z.string().trim().max(150, "En fazla 150 karakter olabilir."),
    job: z.string().trim().max(100, "En fazla 100 karakter olabilir."),
    duty: z.string().trim().max(100, "En fazla 100 karakter olabilir."),
    status: z.enum(BASE_STATUSES, "Çalışma durumunu seçin."),
    hireDate: optionalDate,
    terminationDate: optionalDate,
    tempAssignmentStart: optionalDate,
    reportStart: optionalDate,
    leaveStart: optionalDate,
    absenceDaysCount: z.string().trim().regex(/^(\d{1,4})?$/, "Gün sayısı 0 veya daha büyük bir tam sayı olmalı."),
    returnDate: optionalDate,
    iban: z.string().trim(),
    ibanChanged: z.boolean(),
    dailyWage: z
      .string()
      .trim()
      .refine((v) => v === "" || /^\d{1,10}([.,]\d{1,2})?$/.test(v), "Günlük ücret geçerli bir tutar olmalı (en fazla 2 ondalık)."),
    phone: z
      .string()
      .trim()
      .max(30, "Telefon en fazla 30 karakter olabilir.")
      .regex(/^[0-9+()\s-]*$/, "Telefon yalnızca rakam ve + ( ) - içerebilir."),
  })
  .superRefine((v, ctx) => {
    if (v.tcNoChanged && v.tcNo !== "" && !TC_NO_PATTERN.test(v.tcNo)) {
      ctx.addIssue({ code: "custom", path: ["tcNo"], message: "TC kimlik no 11 haneli olmalı ve 0 ile başlamamalı." });
    }
    if (v.ibanChanged && v.iban !== "" && !isValidIban(v.iban)) {
      ctx.addIssue({ code: "custom", path: ["iban"], message: "Geçerli bir IBAN girin (ör. TR33 0006 1005 1978 6457 8413 26)." });
    }
    if (v.hireDate && v.terminationDate && v.terminationDate < v.hireDate) {
      ctx.addIssue({ code: "custom", path: ["terminationDate"], message: "İşten çıkış tarihi işe giriş tarihinden önce olamaz." });
    }
    const latestStart = [v.leaveStart, v.reportStart, v.tempAssignmentStart].filter(Boolean).sort().at(-1);
    if (v.returnDate && !latestStart) {
      ctx.addIssue({
        code: "custom",
        path: ["returnDate"],
        message: "İşe dönüş tarihi için önce izin, rapor veya geçici görev başlangıcı girin.",
      });
    } else if (v.returnDate && latestStart && v.returnDate <= latestStart) {
      ctx.addIssue({
        code: "custom",
        path: ["returnDate"],
        message: "İşe dönüş tarihi, izin/rapor/geçici görev başlangıcından sonra olmalı.",
      });
    }
  });
export type PersonnelValues = z.infer<typeof personnelSchema>;
