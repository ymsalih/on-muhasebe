-- ============================================================
-- ŞANTİYE / ORTAK YÖNETİMİ: düzenleme, silme ve arşiv
-- ------------------------------------------------------------
-- İlke: VERİSİ OLMAYAN kayıt silinir, VERİSİ OLAN kayıt silinmez, arşive alınır (salt okunur/pasif).
--  * Şantiye   : sahibi (owner) ve admin düzenler/arşivler/siler. Veri varsa silinemez (veritabanı reddeder).
--                Arşivdeki şantiyedeki TÜM veriler salt okunurdur (yazma yardımcıları arşivi bilir).
--  * Üyelik    : sahip, üyeyi çıkarır; üyenin bu şantiyede verisi varsa çıkarılamaz, arşive alınır
--                (kendi verisini görür ama yazamaz).
--  * Hesap     : admin ortağın adını/telefonunu düzenler, şifresini sıfırlar; verisi yoksa siler, varsa arşive alır
--                (giriş kapanır, veriler korunur). Hesap silme/ban işlemi sunucuda (service_role) yapılır.
-- Admin hâlâ şantiye OLUŞTURAMAZ, üye EKLEYEMEZ, operasyonel veri YAZAMAZ.
-- ============================================================

-- ---------- Şema ----------
ALTER TABLE public.sites DROP CONSTRAINT sites_status_check;
ALTER TABLE public.sites ADD CONSTRAINT sites_status_check CHECK (status IN ('active', 'closed', 'archived'));

ALTER TABLE public.site_members ADD COLUMN archived_at TIMESTAMPTZ;
ALTER TABLE public.users ADD COLUMN archived_at TIMESTAMPTZ;   -- yalnızca service_role yazar (sütun yetkisi yok)

-- ---------- Yardımcılar: arşiv = salt okur / giriş yok ----------
-- Arşivdeki (pasif) kullanıcı, geçerli bir oturum belirteci olsa bile hiçbir şantiye göremez.
CREATE OR REPLACE FUNCTION private.is_admin()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (SELECT 1 FROM public.users WHERE id = (SELECT auth.uid()) AND role = 'admin' AND archived_at IS NULL);
$$;

CREATE OR REPLACE FUNCTION private.member_site_ids()
RETURNS SETOF INTEGER LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT m.site_id FROM public.site_members m
  WHERE m.user_id = (SELECT auth.uid())
    AND EXISTS (SELECT 1 FROM public.users u WHERE u.id = m.user_id AND u.archived_at IS NULL);
$$;

-- Yazılabilir şantiyeler: owner/partner, üyeliği arşivde DEĞİL, şantiye arşivde DEĞİL, hesap pasif DEĞİL.
CREATE OR REPLACE FUNCTION private.writable_site_ids()
RETURNS SETOF INTEGER LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT m.site_id FROM public.site_members m
  JOIN public.sites s ON s.id = m.site_id
  WHERE m.user_id = (SELECT auth.uid()) AND m.role IN ('owner', 'partner')
    AND m.archived_at IS NULL AND s.status <> 'archived'
    AND EXISTS (SELECT 1 FROM public.users u WHERE u.id = m.user_id AND u.archived_at IS NULL);
$$;

CREATE OR REPLACE FUNCTION private.owner_site_ids()
RETURNS SETOF INTEGER LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT m.site_id FROM public.site_members m
  WHERE m.user_id = (SELECT auth.uid()) AND m.role = 'owner'
    AND EXISTS (SELECT 1 FROM public.users u WHERE u.id = m.user_id AND u.archived_at IS NULL);
$$;

CREATE OR REPLACE FUNCTION private.can_write_site(p_site_id INTEGER)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (SELECT 1 FROM private.writable_site_ids() w(id) WHERE w.id = p_site_id);
$$;

CREATE OR REPLACE FUNCTION private.has_site_access(p_site_id INTEGER)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT private.is_admin() OR EXISTS (SELECT 1 FROM private.member_site_ids() w(id) WHERE w.id = p_site_id);
$$;

CREATE OR REPLACE FUNCTION private.is_site_owner(p_site_id INTEGER)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (SELECT 1 FROM private.owner_site_ids() w(id) WHERE w.id = p_site_id);
$$;

-- ---------- Veri sayaçları (yalnızca private; kayıtları değil SAYILARI döndürür) ----------
-- Şantiyedeki tüm operasyonel veri (her ortağın özel verisi dahil): silme kararının dayanağı.
CREATE FUNCTION private.site_data_counts(p_site_id INTEGER)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'parties',           (SELECT count(*) FROM public.parties           WHERE site_id = p_site_id),
    'goods_entries',     (SELECT count(*) FROM public.goods_entries     WHERE site_id = p_site_id),
    'personnel',         (SELECT count(*) FROM public.personnel         WHERE site_id = p_site_id),
    'payment_accounts',  (SELECT count(*) FROM public.payment_accounts  WHERE site_id = p_site_id),
    'attendance',        (SELECT count(*) FROM public.attendance        WHERE site_id = p_site_id),
    'transactions',      (SELECT count(*) FROM public.transactions      WHERE site_id = p_site_id),
    'material_entries',  (SELECT count(*) FROM public.material_entries  WHERE site_id = p_site_id),
    'progress_payments', (SELECT count(*) FROM public.progress_payments WHERE site_id = p_site_id),
    'invoices',          (SELECT count(*) FROM public.invoices          WHERE site_id = p_site_id),
    'machines',          (SELECT count(*) FROM public.machines          WHERE site_id = p_site_id),
    'machine_attendance',(SELECT count(*) FROM public.machine_attendance WHERE site_id = p_site_id),
    'fuel_entries',      (SELECT count(*) FROM public.fuel_entries      WHERE site_id = p_site_id)
  );
$$;

CREATE FUNCTION private.sum_counts(p JSONB)
RETURNS BIGINT LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$ SELECT COALESCE(SUM(value::bigint), 0) FROM jsonb_each_text(p); $$;

-- Bir ortağın (p_site_id NULL ise TÜM şantiyelerdeki) kendi girdiği/sahibi olduğu veri.
CREATE FUNCTION private.user_data_counts(p_user_id UUID, p_site_id INTEGER DEFAULT NULL)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'goods_entries',     (SELECT count(*) FROM public.goods_entries     WHERE created_by  = p_user_id AND (p_site_id IS NULL OR site_id = p_site_id)),
    'attendance',        (SELECT count(*) FROM public.attendance        WHERE recorded_by = p_user_id AND (p_site_id IS NULL OR site_id = p_site_id)),
    'transactions',      (SELECT count(*) FROM public.transactions      WHERE user_id     = p_user_id AND (p_site_id IS NULL OR site_id = p_site_id)),
    'material_entries',  (SELECT count(*) FROM public.material_entries  WHERE created_by  = p_user_id AND (p_site_id IS NULL OR site_id = p_site_id)),
    'progress_payments', (SELECT count(*) FROM public.progress_payments WHERE created_by  = p_user_id AND (p_site_id IS NULL OR site_id = p_site_id)),
    'invoices',          (SELECT count(*) FROM public.invoices          WHERE created_by  = p_user_id AND (p_site_id IS NULL OR site_id = p_site_id)),
    'machines',          (SELECT count(*) FROM public.machines          WHERE owner_id    = p_user_id AND (p_site_id IS NULL OR site_id = p_site_id)),
    'machine_attendance',(SELECT count(*) FROM public.machine_attendance WHERE owner_id   = p_user_id AND (p_site_id IS NULL OR site_id = p_site_id)),
    'fuel_entries',      (SELECT count(*) FROM public.fuel_entries      WHERE owner_id    = p_user_id AND (p_site_id IS NULL OR site_id = p_site_id))
  ) || CASE WHEN p_site_id IS NULL
         THEN jsonb_build_object('company_entries', (SELECT count(*) FROM public.company_entries WHERE owner_id = p_user_id))
         ELSE '{}'::jsonb END;
$$;

REVOKE ALL ON FUNCTION private.site_data_counts(INTEGER), private.sum_counts(JSONB), private.user_data_counts(UUID, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.site_data_counts(INTEGER), private.sum_counts(JSONB), private.user_data_counts(UUID, INTEGER) TO authenticated, service_role;

-- Üye silme politikası: üyenin bu şantiyede verisi varsa doğrudan silinemez (arşive alınır).
CREATE FUNCTION private.member_has_data(p_site_id INTEGER, p_user_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$ SELECT private.sum_counts(private.user_data_counts(p_user_id, p_site_id)) > 0; $$;
REVOKE ALL ON FUNCTION private.member_has_data(INTEGER, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.member_has_data(INTEGER, UUID) TO authenticated;

DROP POLICY site_members_delete_by_owner ON public.site_members;
CREATE POLICY site_members_delete_by_owner ON public.site_members FOR DELETE TO authenticated
  USING (private.is_site_owner(site_id) AND role <> 'owner' AND NOT private.member_has_data(site_id, user_id));

-- ---------- RPC'ler (arayüzün çağırdığı; yetki ve veri kuralı BURADA uygulanır) ----------
-- Şantiyedeki veri özeti: yalnızca admin ve şantiyenin sahibi.
CREATE FUNCTION public.get_site_data_summary(p_site_id INTEGER)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v JSONB;
BEGIN
  IF NOT (private.is_admin() OR private.is_site_owner(p_site_id)) THEN
    RAISE EXCEPTION 'Bu işlem için şantiyenin sahibi veya admin olmanız gerekir.' USING ERRCODE = '42501';
  END IF;
  v := private.site_data_counts(p_site_id);
  RETURN jsonb_build_object('counts', v, 'total', private.sum_counts(v),
                            'members', (SELECT count(*) FROM public.site_members WHERE site_id = p_site_id));
END;
$$;

-- Şantiyedeki üyelerin bu şantiyedeki veri toplamı (çıkar / arşive al kararı için). Sahip veya admin.
CREATE FUNCTION public.get_member_data_totals(p_site_id INTEGER)
RETURNS TABLE (user_id UUID, total BIGINT) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NOT (private.is_admin() OR private.is_site_owner(p_site_id)) THEN
    RAISE EXCEPTION 'Bu işlem için şantiyenin sahibi veya admin olmanız gerekir.' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT m.user_id, private.sum_counts(private.user_data_counts(m.user_id, p_site_id))
  FROM public.site_members m WHERE m.site_id = p_site_id;
END;
$$;

-- Ortak hesabının veri özeti (tüm şantiyeler): yalnızca admin.
CREATE FUNCTION public.get_user_data_summary(p_user_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v JSONB;
BEGIN
  IF NOT private.is_admin() THEN
    RAISE EXCEPTION 'Bu işlem yalnızca admin içindir.' USING ERRCODE = '42501';
  END IF;
  v := private.user_data_counts(p_user_id, NULL);
  RETURN jsonb_build_object(
    'counts', v, 'total', private.sum_counts(v),
    'owned_sites',  (SELECT count(*) FROM public.site_members WHERE user_id = p_user_id AND role = 'owner'),
    'member_sites', (SELECT count(*) FROM public.site_members WHERE user_id = p_user_id));
END;
$$;

-- Şantiye bilgilerini düzenle (ad, adres, başlangıç): sahip veya admin.
CREATE FUNCTION public.update_site_details(p_site_id INTEGER, p_name TEXT, p_address TEXT, p_start_date DATE)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NOT (private.is_admin() OR private.is_site_owner(p_site_id)) THEN
    RAISE EXCEPTION 'Bu işlem için şantiyenin sahibi veya admin olmanız gerekir.' USING ERRCODE = '42501';
  END IF;
  IF length(btrim(coalesce(p_name, ''))) < 2 OR length(btrim(p_name)) > 150 THEN
    RAISE EXCEPTION 'Şantiye adı 2-150 karakter olmalı.' USING ERRCODE = '23514';
  END IF;
  UPDATE public.sites SET name = btrim(p_name), address = NULLIF(btrim(coalesce(p_address, '')), ''), start_date = p_start_date
  WHERE id = p_site_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Şantiye bulunamadı.' USING ERRCODE = 'P0002'; END IF;
END;
$$;

-- Arşive al / arşivden çıkar: sahip veya admin. Arşivdeki şantiyede veri yazılamaz.
CREATE FUNCTION public.set_site_archived(p_site_id INTEGER, p_archived BOOLEAN)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NOT (private.is_admin() OR private.is_site_owner(p_site_id)) THEN
    RAISE EXCEPTION 'Bu işlem için şantiyenin sahibi veya admin olmanız gerekir.' USING ERRCODE = '42501';
  END IF;
  UPDATE public.sites SET status = CASE WHEN p_archived THEN 'archived' ELSE 'active' END WHERE id = p_site_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Şantiye bulunamadı.' USING ERRCODE = 'P0002'; END IF;
END;
$$;

-- Şantiyeyi sil: sahip veya admin; HİÇBİR ortağın verisi yoksa. Veri varsa reddedilir (55000) → arşive alınmalı.
CREATE FUNCTION public.delete_site(p_site_id INTEGER)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NOT (private.is_admin() OR private.is_site_owner(p_site_id)) THEN
    RAISE EXCEPTION 'Bu işlem için şantiyenin sahibi veya admin olmanız gerekir.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.sites WHERE id = p_site_id) THEN
    RAISE EXCEPTION 'Şantiye bulunamadı.' USING ERRCODE = 'P0002';
  END IF;
  IF private.sum_counts(private.site_data_counts(p_site_id)) > 0 THEN
    RAISE EXCEPTION 'Şantiyede veri var; silinemez, arşive alın.' USING ERRCODE = '55000';
  END IF;
  DELETE FROM public.sites WHERE id = p_site_id;   -- üyelikler CASCADE ile kalkar
END;
$$;

-- Üyeyi çıkar: yalnızca sahip; üyenin bu şantiyede verisi varsa reddedilir (55000) → arşive alınmalı.
CREATE FUNCTION public.remove_site_member(p_site_id INTEGER, p_member_id INTEGER)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_user UUID; v_role TEXT;
BEGIN
  IF NOT private.is_site_owner(p_site_id) THEN
    RAISE EXCEPTION 'Bu işlem için şantiyenin sahibi olmanız gerekir.' USING ERRCODE = '42501';
  END IF;
  SELECT user_id, role INTO v_user, v_role FROM public.site_members WHERE id = p_member_id AND site_id = p_site_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Üye bulunamadı.' USING ERRCODE = 'P0002'; END IF;
  IF v_role = 'owner' THEN RAISE EXCEPTION 'Şantiyenin sahibi çıkarılamaz.' USING ERRCODE = '42501'; END IF;
  IF private.member_has_data(p_site_id, v_user) THEN
    RAISE EXCEPTION 'Ortağın bu şantiyede verisi var; çıkarılamaz, arşive alın.' USING ERRCODE = '55000';
  END IF;
  DELETE FROM public.site_members WHERE id = p_member_id;
END;
$$;

-- Üyeyi arşive al / geri al: yalnızca sahip. Arşivdeki üye kendi verisini görür ama yazamaz.
CREATE FUNCTION public.set_member_archived(p_site_id INTEGER, p_member_id INTEGER, p_archived BOOLEAN)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_role TEXT;
BEGIN
  IF NOT private.is_site_owner(p_site_id) THEN
    RAISE EXCEPTION 'Bu işlem için şantiyenin sahibi olmanız gerekir.' USING ERRCODE = '42501';
  END IF;
  SELECT role INTO v_role FROM public.site_members WHERE id = p_member_id AND site_id = p_site_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Üye bulunamadı.' USING ERRCODE = 'P0002'; END IF;
  IF v_role = 'owner' THEN RAISE EXCEPTION 'Şantiyenin sahibi arşive alınamaz.' USING ERRCODE = '42501'; END IF;
  UPDATE public.site_members SET archived_at = CASE WHEN p_archived THEN now() ELSE NULL END WHERE id = p_member_id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_site_data_summary(INTEGER), public.get_member_data_totals(INTEGER), public.get_user_data_summary(UUID),
  public.update_site_details(INTEGER, TEXT, TEXT, DATE), public.set_site_archived(INTEGER, BOOLEAN), public.delete_site(INTEGER),
  public.remove_site_member(INTEGER, INTEGER), public.set_member_archived(INTEGER, INTEGER, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_site_data_summary(INTEGER), public.get_member_data_totals(INTEGER), public.get_user_data_summary(UUID),
  public.update_site_details(INTEGER, TEXT, TEXT, DATE), public.set_site_archived(INTEGER, BOOLEAN), public.delete_site(INTEGER),
  public.remove_site_member(INTEGER, INTEGER), public.set_member_archived(INTEGER, INTEGER, BOOLEAN) TO authenticated, service_role;

-- Ortak arama: pasif (arşivdeki) hesaplar şantiyeye eklenemez.
CREATE OR REPLACE FUNCTION public.search_users_for_site(p_site_id INTEGER, p_query TEXT)
RETURNS TABLE (id UUID, full_name VARCHAR, email VARCHAR)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_pattern TEXT;
BEGIN
  IF NOT private.is_site_owner(p_site_id) THEN
    RAISE EXCEPTION 'Bu şantiyenin sahibi değilsiniz.' USING ERRCODE = '42501';
  END IF;
  IF length(btrim(coalesce(p_query, ''))) < 2 THEN
    RETURN;
  END IF;
  v_pattern := '%' || replace(replace(replace(btrim(p_query), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  RETURN QUERY
  SELECT u.id, u.full_name, u.email
  FROM public.users u
  WHERE u.role = 'partner' AND u.archived_at IS NULL
    AND (u.full_name ILIKE v_pattern OR u.email ILIKE v_pattern)
    AND NOT EXISTS (SELECT 1 FROM public.site_members m WHERE m.site_id = p_site_id AND m.user_id = u.id)
  ORDER BY u.full_name
  LIMIT 10;
END;
$$;
