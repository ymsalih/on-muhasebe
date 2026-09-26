import { z } from "zod";

const phoneSchema = z
  .string()
  .max(30, "Telefon en fazla 30 karakter olabilir.")
  .regex(/^[0-9+()\s-]*$/, "Telefon yalnızca rakam ve + ( ) - içerebilir.");

/** Admin yalnızca kullanıcı HESABI açar; şantiye ataması ortakların kendi işidir (CLAUDE.md Bölüm 1 ve 3). */
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
});
export type CreatePartnerValues = z.infer<typeof createPartnerSchema>;
