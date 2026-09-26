-- ============================================================
-- FAZ 1 — Temel altyapı: users, sites, site_members + RLS
-- ============================================================
-- users.id, auth.users.id ile birebir eşleşen UUID'dir (CLAUDE.md Bölüm 6, bootstrap).
-- password_hash tutulmaz: parolalar yalnızca Supabase Auth'ta durur.

-- ------------------------------------------------------------
-- TABLOLAR
-- ------------------------------------------------------------

CREATE TABLE public.users (
  id                    UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name             VARCHAR(120) NOT NULL,
  email                 VARCHAR(180) UNIQUE NOT NULL,
  role                  VARCHAR(20)  NOT NULL DEFAULT 'partner' CHECK (role IN ('admin', 'partner')),
  phone                 VARCHAR(30),
  must_change_password  BOOLEAN      NOT NULL DEFAULT true,  -- true ise giriş sonrası şifre değiştirmeye zorlanır
  created_at            TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE public.sites (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(150) NOT NULL,
  address     TEXT,
  start_date  DATE,
  status      VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed')),
  created_by  UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Modülerliğin çekirdeği: kim hangi şantiyeye erişebiliyor
CREATE TABLE public.site_members (
  id                SERIAL PRIMARY KEY,
  site_id           INTEGER NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  user_id           UUID    NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  role              VARCHAR(20) NOT NULL DEFAULT 'partner' CHECK (role IN ('owner', 'partner', 'viewer')),
  share_percentage  NUMERIC(5,2) CHECK (share_percentage IS NULL OR (share_percentage >= 0 AND share_percentage <= 100)),
  joined_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (site_id, user_id)
);

CREATE INDEX idx_site_members_user ON public.site_members(user_id);
CREATE INDEX idx_sites_created_by  ON public.sites(created_by);

-- ------------------------------------------------------------
-- RLS YARDIMCI FONKSİYONLARI
-- ------------------------------------------------------------
-- `private` şeması API'ye açılmaz; SECURITY DEFINER fonksiyonlar RLS'i atlayarak
-- çalıştığı için politikalar arasında sonsuz özyineleme oluşmaz.
-- Sonraki fazlardaki tüm operasyonel tablolar da bu fonksiyonları kullanacak.

CREATE SCHEMA IF NOT EXISTS private;
GRANT USAGE ON SCHEMA private TO authenticated;

CREATE FUNCTION private.is_admin()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users WHERE id = (SELECT auth.uid()) AND role = 'admin'
  );
$$;

-- Admin tüm şantiyelere, partner yalnızca üyesi olduğu şantiyelere erişir.
CREATE FUNCTION private.has_site_access(p_site_id INTEGER)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT private.is_admin() OR EXISTS (
    SELECT 1 FROM public.site_members
    WHERE site_id = p_site_id AND user_id = (SELECT auth.uid())
  );
$$;

-- Şantiyenin sahibi (owner) mi? (viewer/partner yazma yetkisini ayırmak için)
CREATE FUNCTION private.is_site_owner(p_site_id INTEGER)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.site_members
    WHERE site_id = p_site_id AND user_id = (SELECT auth.uid()) AND role = 'owner'
  );
$$;

-- Aynı şantiyede ortak olduğum kullanıcı mı? ("kim girdi" gibi alanlarda ad göstermek için)
CREATE FUNCTION private.shares_site_with(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.site_members me
    JOIN public.site_members other ON other.site_id = me.site_id
    WHERE me.user_id = (SELECT auth.uid()) AND other.user_id = p_user_id
  );
$$;

REVOKE ALL ON FUNCTION private.is_admin(), private.has_site_access(INTEGER),
  private.is_site_owner(INTEGER), private.shares_site_with(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.is_admin(), private.has_site_access(INTEGER),
  private.is_site_owner(INTEGER), private.shares_site_with(UUID) TO authenticated;

-- ------------------------------------------------------------
-- RLS
-- ------------------------------------------------------------

ALTER TABLE public.users        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sites        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.site_members ENABLE ROW LEVEL SECURITY;

-- Anonim (giriş yapmamış) kullanıcı hiçbir şeye erişemez.
REVOKE ALL ON public.users, public.sites, public.site_members FROM anon;
REVOKE ALL ON public.users, public.sites, public.site_members FROM authenticated;
GRANT SELECT ON public.users        TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sites, public.site_members TO authenticated;
GRANT USAGE ON SEQUENCE public.sites_id_seq, public.site_members_id_seq TO authenticated;

-- Kullanıcı kendi profilinde yalnızca bu sütunları değiştirebilir (role kendi kendine yükseltilemez).
-- Kullanıcı oluşturma/silme ve rol değişikliği yalnızca service_role (admin server action'ları) ile yapılır.
GRANT UPDATE (full_name, phone, must_change_password) ON public.users TO authenticated;

-- users
CREATE POLICY users_select ON public.users FOR SELECT TO authenticated
  USING (id = (SELECT auth.uid()) OR private.is_admin() OR private.shares_site_with(id));

CREATE POLICY users_update_self ON public.users FOR UPDATE TO authenticated
  USING (id = (SELECT auth.uid()))
  WITH CHECK (id = (SELECT auth.uid()));

-- sites
CREATE POLICY sites_select ON public.sites FOR SELECT TO authenticated
  USING (private.has_site_access(id));

CREATE POLICY sites_insert_admin ON public.sites FOR INSERT TO authenticated
  WITH CHECK (private.is_admin());

CREATE POLICY sites_update ON public.sites FOR UPDATE TO authenticated
  USING (private.is_admin() OR private.is_site_owner(id))
  WITH CHECK (private.is_admin() OR private.is_site_owner(id));

CREATE POLICY sites_delete_admin ON public.sites FOR DELETE TO authenticated
  USING (private.is_admin());

-- site_members: herkes kendi üyeliklerini görür; sahip/admin şantiyenin tüm üyelerini görür; yazma yalnızca admin.
CREATE POLICY site_members_select ON public.site_members FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) OR private.is_admin() OR private.is_site_owner(site_id));

CREATE POLICY site_members_insert_admin ON public.site_members FOR INSERT TO authenticated
  WITH CHECK (private.is_admin());

CREATE POLICY site_members_update_admin ON public.site_members FOR UPDATE TO authenticated
  USING (private.is_admin()) WITH CHECK (private.is_admin());

CREATE POLICY site_members_delete_admin ON public.site_members FOR DELETE TO authenticated
  USING (private.is_admin());
