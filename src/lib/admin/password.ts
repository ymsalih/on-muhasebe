// Karışması kolay karakterler (0/O, 1/l/I) çıkarıldı: şifre telefonla/WhatsApp'la iletilecek.
const PASSWORD_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";

/** Tarayıcıda kriptografik rastgele geçici şifre üretir. */
export function generatePassword(length = 12): string {
  const bytes = new Uint32Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => PASSWORD_ALPHABET[b % PASSWORD_ALPHABET.length]).join("");
}
