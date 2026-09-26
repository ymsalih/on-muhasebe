import { z } from "zod";

const phoneSchema = z
  .string()
  .max(30, "Telefon en fazla 30 karakter olabilir.")
  .regex(/^[0-9+()\s-]*$/, "Telefon yalnızca rakam ve + ( ) - içerebilir.");

export const createPartnerSchema = z.object({
  fullName: z.string().trim().min(2, "Ad soyad en az 2 karakter olmalı.").max(120, "Ad soyad çok uzun."),
  email: z
    .string()
    .trim()
    .min(1, "E-posta adresini girin.")
    .email("Geçerli bir e-posta adresi girin.")
    .max(180, "E-posta çok uzun."),
  phone: phoneSchema,
  password: z.string().min(8, "Geçici şifre en az 8 karakter olmalı.").max(72, "Şifre en fazla 72 karakter olabilir."),
  siteIds: z.array(z.number().int().positive()),
});
export type CreatePartnerValues = z.infer<typeof createPartnerSchema>;

export const SITE_MEMBER_ROLES = ["owner", "partner", "viewer"] as const;
export const SITE_MEMBER_ROLE_LABELS: Record<(typeof SITE_MEMBER_ROLES)[number], string> = {
  owner: "Sahip",
  partner: "Ortak",
  viewer: "Görüntüleyici",
};

export const siteMemberSchema = z.object({
  userId: z.string().uuid(),
  role: z.enum(SITE_MEMBER_ROLES),
  sharePercentage: z
    .number("Yüzde sayı olmalı.")
    .min(0, "Yüzde 0'dan küçük olamaz.")
    .max(100, "Yüzde 100'den büyük olamaz.")
    .nullable(),
});
export type SiteMemberValues = z.infer<typeof siteMemberSchema>;

const totalShareWithin100 = (members: SiteMemberValues[]) =>
  members.reduce((sum, m) => sum + (m.sharePercentage ?? 0), 0) <= 100.0001;

export const createSiteSchema = z.object({
  name: z.string().trim().min(2, "Şantiye adı en az 2 karakter olmalı.").max(150, "Şantiye adı çok uzun."),
  address: z.string().trim().max(500, "Adres en fazla 500 karakter olabilir."),
  startDate: z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Geçerli bir tarih seçin.")]),
  members: z.array(siteMemberSchema).refine(totalShareWithin100, "Kâr payı yüzdeleri toplamı 100'ü geçemez."),
});
export type CreateSiteValues = z.infer<typeof createSiteSchema>;

export const addMemberSchema = siteMemberSchema.extend({ siteId: z.number().int().positive() });
