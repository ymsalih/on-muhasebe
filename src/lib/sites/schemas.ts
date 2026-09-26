import { z } from "zod";

export const SITE_MEMBER_ROLES = ["owner", "partner", "viewer"] as const;
export type SiteMemberRole = (typeof SITE_MEMBER_ROLES)[number];

export const SITE_MEMBER_ROLE_LABELS: Record<SiteMemberRole, string> = {
  owner: "Sahip",
  partner: "Ortak",
  viewer: "Görüntüleyici",
};

/** Sahip, başkasına yalnızca bu rolleri verebilir (RLS de aynısını zorlar). */
export const ADDABLE_ROLES = ["partner", "viewer"] as const;

export const createSiteSchema = z.object({
  name: z.string().trim().min(2, "Şantiye adı en az 2 karakter olmalı.").max(150, "Şantiye adı çok uzun."),
  address: z.string().trim().max(500, "Adres en fazla 500 karakter olabilir."),
  startDate: z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Geçerli bir tarih seçin.")]),
});
export type CreateSiteValues = z.infer<typeof createSiteSchema>;

export const addMemberSchema = z.object({
  siteId: z.number().int().positive(),
  userId: z.string().uuid("Geçersiz kullanıcı."),
  role: z.enum(ADDABLE_ROLES, "Rol olarak Ortak veya Görüntüleyici seçin."),
});
export type AddMemberValues = z.infer<typeof addMemberSchema>;
