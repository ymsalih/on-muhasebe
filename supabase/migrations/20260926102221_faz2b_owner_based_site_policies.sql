-- ============================================================
-- FAZ 2 DÜZELTME — Şantiye oluşturma/üye ekleme ortağın işidir, admin salt görüntüler
-- ============================================================
-- Önceki migration'lar değiştirilmez; bu dosya politikaları üzerine yazar.
-- Kaynak: CLAUDE.md Bölüm 1 ve 3 (RLS insert politikaları).

-- ------------------------------------------------------------
-- YARDIMCI FONKSİYONLAR (private: API'ye açılmaz, RLS içinden çağrılır)
-- ------------------------------------------------------------

-- Şantiyenin hiç üyesi var mı? (ilk üye = oluşturan sahibi; sonradan yeniden sahiplenmeyi engeller)
CREATE FUNCTION private.site_has_members(p_site_id INTEGER)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (SELECT 1 FROM public.site_members WHERE site_id = p_site_id);
$$;

-- Bu şantiyeyi çağıran kullanıcı mı oluşturdu?
CREATE FUNCTION private.is_site_creator(p_site_id INTEGER)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.sites
    WHERE id = p_site_id AND created_by = (SELECT auth.uid())
  );
$$;

-- Hedef kullanıcı 'partner' rolünde mi? (admin hesapları şantiyeye üye yapılamaz)
CREATE FUNCTION private.is_partner(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (SELECT 1 FROM public.users WHERE id = p_user_id AND role = 'partner');
$$;

REVOKE ALL ON FUNCTION private.site_has_members(INTEGER), private.is_site_creator(INTEGER),
  private.is_partner(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.site_has_members(INTEGER), private.is_site_creator(INTEGER),
  private.is_partner(UUID) TO authenticated;

-- ------------------------------------------------------------
-- TABLO YETKİLERİ (GRANT) — kapsamı daralt
-- ------------------------------------------------------------
-- sites: silme yok (kimse); güncelleme yalnızca ad/adres/tarih/durum (created_by değiştirilemez).
-- site_members: güncelleme yok (rol değişikliği = çıkar + yeniden ekle).
REVOKE ALL ON public.sites, public.site_members FROM authenticated;
GRANT SELECT, INSERT ON public.sites TO authenticated;
GRANT UPDATE (name, address, start_date, status) ON public.sites TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.site_members TO authenticated;

-- ------------------------------------------------------------
-- sites
-- ------------------------------------------------------------
DROP POLICY sites_select       ON public.sites;
DROP POLICY sites_insert_admin ON public.sites;
DROP POLICY sites_update       ON public.sites;
DROP POLICY sites_delete_admin ON public.sites;

-- Görme: admin (salt görüntüleme) + üyeler. Ek olarak oluşturan, sahip satırı eklenene kadar
-- (INSERT ... RETURNING için) yeni şantiyesini görebilir; üye olduktan sonra normal yoldan görür.
CREATE POLICY sites_select ON public.sites FOR SELECT TO authenticated
  USING (
    private.has_site_access(id)
    OR (created_by = (SELECT auth.uid()) AND NOT private.site_has_members(id))
  );

-- Herhangi bir giriş yapmış kullanıcı kendi adına şantiye oluşturur; admin oluşturamaz.
CREATE POLICY sites_insert_own ON public.sites FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT auth.uid()) IS NOT NULL
    AND created_by = (SELECT auth.uid())
    AND NOT private.is_admin()
  );

-- Yalnızca şantiyenin sahibi (owner) günceller. Admin güncelleyemez.
CREATE POLICY sites_update_owner ON public.sites FOR UPDATE TO authenticated
  USING (private.is_site_owner(id))
  WITH CHECK (private.is_site_owner(id));

-- ------------------------------------------------------------
-- site_members
-- ------------------------------------------------------------
DROP POLICY site_members_insert_admin ON public.site_members;
DROP POLICY site_members_update_admin ON public.site_members;
DROP POLICY site_members_delete_admin ON public.site_members;
-- site_members_select (kendi üyeliğim / admin / şantiyenin sahibi) aynen kalır.

-- (a) Kendi oluşturduğu şantiyeye, ilk üye olarak, kendini owner ekler.
-- (b) Şantiyenin owner'ı, sistemde hesabı olan başka bir ORTAĞI partner/viewer olarak ekler.
CREATE POLICY site_members_insert ON public.site_members FOR INSERT TO authenticated
  WITH CHECK (
    (
      user_id = (SELECT auth.uid())
      AND role = 'owner'
      AND private.is_site_creator(site_id)
      AND NOT private.site_has_members(site_id)
      AND NOT private.is_admin()
    )
    OR (
      private.is_site_owner(site_id)
      AND role IN ('partner', 'viewer')
      AND private.is_partner(user_id)
    )
  );

-- Sahip, şantiyedeki sahip olmayan üyeleri çıkarabilir (sahibin kendisi çıkarılamaz).
CREATE POLICY site_members_delete_by_owner ON public.site_members FOR DELETE TO authenticated
  USING (private.is_site_owner(site_id) AND role <> 'owner');

-- ------------------------------------------------------------
-- RPC: atomik şantiye oluşturma (SECURITY INVOKER → yukarıdaki RLS politikaları aynen geçerli)
-- ------------------------------------------------------------
CREATE FUNCTION public.create_site(p_name TEXT, p_address TEXT DEFAULT NULL, p_start_date DATE DEFAULT NULL)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_site_id INTEGER;
BEGIN
  INSERT INTO public.sites (name, address, start_date, created_by)
  VALUES (btrim(p_name), NULLIF(btrim(p_address), ''), p_start_date, (SELECT auth.uid()))
  RETURNING id INTO v_site_id;

  INSERT INTO public.site_members (site_id, user_id, role)
  VALUES (v_site_id, (SELECT auth.uid()), 'owner');

  RETURN v_site_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_site(TEXT, TEXT, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_site(TEXT, TEXT, DATE) TO authenticated;

-- ------------------------------------------------------------
-- RPC: şantiyeye eklenebilecek ortakları ara ("Şantiye Ortakları" ekranı)
-- ------------------------------------------------------------
-- users tablosu RLS gereği yalnızca ortak şantiyedeki kişileri gösterir; henüz hiçbir şantiyeyi paylaşmadığınız
-- bir ortağı bulmak için dar kapsamlı bir arama gerekir. Yalnızca şantiyenin owner'ı çağırabilir; yalnızca
-- ortak hesapları (admin değil), şantiyenin mevcut üyeleri hariç, en az 2 karakterle, en fazla 10 sonuç döner.
CREATE FUNCTION public.search_users_for_site(p_site_id INTEGER, p_query TEXT)
RETURNS TABLE (id UUID, full_name VARCHAR, email VARCHAR)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
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
  WHERE u.role = 'partner'
    AND (u.full_name ILIKE v_pattern OR u.email ILIKE v_pattern)
    AND NOT EXISTS (
      SELECT 1 FROM public.site_members m WHERE m.site_id = p_site_id AND m.user_id = u.id
    )
  ORDER BY u.full_name
  LIMIT 10;
END;
$$;

REVOKE ALL ON FUNCTION public.search_users_for_site(INTEGER, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_users_for_site(INTEGER, TEXT) TO authenticated;
