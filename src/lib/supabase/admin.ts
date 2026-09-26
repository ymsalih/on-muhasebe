import "server-only";
import { createClient } from "@supabase/supabase-js";

/**
 * service_role istemcisi — RLS'i atlar. YALNIZCA sunucuda (server action / route handler)
 * ve yalnızca çağıran kullanıcının admin olduğu doğrulandıktan sonra kullanın (bkz. requireAdmin).
 */
export function createAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY tanımlı değil.");

  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
