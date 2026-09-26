import { z } from "zod";

export const loginSchema = z.object({
  email: z.string().min(1, "E-posta adresini girin.").email("Geçerli bir e-posta adresi girin."),
  password: z.string().min(1, "Şifrenizi girin."),
});
export type LoginValues = z.infer<typeof loginSchema>;

export const forgotPasswordSchema = z.object({
  email: z.string().min(1, "E-posta adresini girin.").email("Geçerli bir e-posta adresi girin."),
});
export type ForgotPasswordValues = z.infer<typeof forgotPasswordSchema>;

export const changePasswordSchema = z
  .object({
    password: z.string().min(8, "Şifre en az 8 karakter olmalı."),
    confirm: z.string().min(1, "Şifreyi tekrar girin."),
  })
  .refine((v) => v.password === v.confirm, {
    path: ["confirm"],
    message: "Şifreler eşleşmiyor.",
  });
export type ChangePasswordValues = z.infer<typeof changePasswordSchema>;
