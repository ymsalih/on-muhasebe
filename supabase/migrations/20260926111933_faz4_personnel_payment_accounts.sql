-- ============================================================
-- FAZ 4 — personnel + payment_accounts (+ hassas veri erişim kısıtı)
-- ============================================================
-- Şema CLAUDE.md Bölüm 4 ile aynıdır; farklar:
--  * Tüm çapraz referanslar (employer_party_id, personnel_id, party_id) (id, site_id) BİLEŞİK yabancı anahtardır:
--    başka şantiyenin firması/personeli bağlanamaz.
--  * HASSAS VERİ (Bölüm 6): personnel.tc_no, personnel.iban, payment_accounts.iban sütunlarında `authenticated`
--    rolünün SELECT yetkisi YOKTUR. Bu yüzden hiçbir varsayılan API cevabı (select * dahil) bu değerleri döndüremez.
--    Yalnızca "dolu mu" bilgisi (has_tc_no / has_iban) okunabilir. Gerçek değer, SECURITY DEFINER RPC'lerle yalnızca
--    admin ile şantiyenin owner/partner üyelerine açılır (viewer'a açılmaz) ve her erişim günlüğe yazılır.
--  * users(id) referansı yok (bu tablolarda created_by tutulmuyor).

-- ------------------------------------------------------------
-- personnel
-- ------------------------------------------------------------
CREATE TABLE public.personnel (
  id                     SERIAL PRIMARY KEY,
  site_id                INTEGER NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  full_name              VARCHAR(150) NOT NULL CHECK (length(btrim(full_name)) > 0),   -- 1. adı soyadı
  tc_no                  VARCHAR(11) CHECK (tc_no ~ '^[1-9][0-9]{10}$'),               -- 2. TC kimlik no (HASSAS)
  employer_party_id      INTEGER,                                                      -- 3. çalıştığı firma
  insurance_company      VARCHAR(150),                                                 -- 4. sigortayı yapan firma
  job                    VARCHAR(100),                                                 -- 5. işi
  duty                   VARCHAR(100),                                                 -- 6. görevi
  status                 VARCHAR(30) NOT NULL DEFAULT 'aktif'
                         CHECK (status IN ('aktif', 'izinli', 'raporlu', 'gecici_gorevde', 'ayrildi')),  -- 7.
  hire_date              DATE,                                                         -- 8. işe giriş
  termination_date       DATE,                                                         -- 9. işten çıkış
  temp_assignment_start  DATE,                                                         -- 10. geçici görev başlangıcı
  report_start           DATE,                                                         -- 11. rapor başlangıcı
  leave_start            DATE,                                                         -- 12. izin başlangıcı
  absence_days_count     INTEGER CHECK (absence_days_count IS NULL OR absence_days_count >= 0),  -- 13.
  return_date            DATE,                                                         -- 14. işe dönüş
  iban                   VARCHAR(34) CHECK (iban ~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$'),   -- 15. IBAN (HASSAS)
  phone                  VARCHAR(30),                                                  -- 16. telefon
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Yalnızca "dolu mu" bilgisi: arayüz ●●●● gösterebilsin diye. Gerçek değer sızmaz.
  has_tc_no              BOOLEAN GENERATED ALWAYS AS (tc_no IS NOT NULL) STORED,
  has_iban               BOOLEAN GENERATED ALWAYS AS (iban IS NOT NULL) STORED,
  CONSTRAINT personnel_dates_check CHECK (termination_date IS NULL OR hire_date IS NULL OR termination_date >= hire_date),
  UNIQUE (id, site_id),   -- bileşik yabancı anahtar hedefi (attendance, payment_accounts, transactions)
  CONSTRAINT personnel_employer_party_same_site_fk
    FOREIGN KEY (employer_party_id, site_id) REFERENCES public.parties (id, site_id)
);

-- Aynı şantiyede aynı TC ile ikinci personel açılmasın.
CREATE UNIQUE INDEX uq_personnel_site_tc ON public.personnel (site_id, tc_no) WHERE tc_no IS NOT NULL;
CREATE INDEX idx_personnel_site        ON public.personnel(site_id);
CREATE INDEX idx_personnel_site_status ON public.personnel(site_id, status);

-- ------------------------------------------------------------
-- payment_accounts (personel dışında ödeme yapılan herkes için IBAN listesi)
-- ------------------------------------------------------------
CREATE TABLE public.payment_accounts (
  id            SERIAL PRIMARY KEY,
  site_id       INTEGER NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  full_name     VARCHAR(150) NOT NULL CHECK (length(btrim(full_name)) > 0),   -- 1. ad soyad
  iban          VARCHAR(34) NOT NULL CHECK (iban ~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$'),  -- 2. IBAN (HASSAS)
  profession    VARCHAR(100),                                                  -- 3. mesleği
  personnel_id  INTEGER,                                                       -- opsiyonel: personelle ilişkilendir
  party_id      INTEGER,                                                       -- opsiyonel: cari ile ilişkilendir
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT payment_accounts_personnel_same_site_fk
    FOREIGN KEY (personnel_id, site_id) REFERENCES public.personnel (id, site_id),
  CONSTRAINT payment_accounts_party_same_site_fk
    FOREIGN KEY (party_id, site_id) REFERENCES public.parties (id, site_id)
);
CREATE INDEX idx_payment_accounts_site ON public.payment_accounts(site_id);

-- ------------------------------------------------------------
-- HASSAS VERİ ERİŞİM GÜNLÜĞÜ (yalnızca admin okur; yazma yalnızca aşağıdaki RPC'lerle)
-- ------------------------------------------------------------
CREATE TABLE public.sensitive_access_log (
  id           BIGSERIAL PRIMARY KEY,
  user_id      UUID REFERENCES public.users(id) ON DELETE SET NULL,
  table_name   TEXT NOT NULL,
  record_id    INTEGER NOT NULL,
  site_id      INTEGER,
  accessed_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_sensitive_access_log_time ON public.sensitive_access_log(accessed_at DESC);

-- ------------------------------------------------------------
-- YETKİLER (GRANT) + RLS
-- ------------------------------------------------------------
ALTER TABLE public.personnel            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_accounts     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sensitive_access_log ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.personnel, public.payment_accounts, public.sensitive_access_log FROM anon, authenticated;

-- personnel: tc_no ve iban için SELECT YOK (sütun düzeyi). INSERT/UPDATE serbest (yazma yetkilileri değeri girer/değiştirir).
GRANT SELECT (id, site_id, full_name, employer_party_id, insurance_company, job, duty, status, hire_date,
              termination_date, temp_assignment_start, report_start, leave_start, absence_days_count,
              return_date, phone, created_at, has_tc_no, has_iban)
  ON public.personnel TO authenticated;
GRANT INSERT (site_id, full_name, tc_no, employer_party_id, insurance_company, job, duty, status, hire_date,
              termination_date, temp_assignment_start, report_start, leave_start, absence_days_count,
              return_date, iban, phone)
  ON public.personnel TO authenticated;
GRANT UPDATE (full_name, tc_no, employer_party_id, insurance_company, job, duty, status, hire_date,
              termination_date, temp_assignment_start, report_start, leave_start, absence_days_count,
              return_date, iban, phone)
  ON public.personnel TO authenticated;                                       -- site_id değiştirilemez
GRANT DELETE ON public.personnel TO authenticated;

-- payment_accounts: iban için SELECT YOK.
GRANT SELECT (id, site_id, full_name, profession, personnel_id, party_id, notes, created_at)
  ON public.payment_accounts TO authenticated;
GRANT INSERT (site_id, full_name, iban, profession, personnel_id, party_id, notes)
  ON public.payment_accounts TO authenticated;
GRANT UPDATE (full_name, iban, profession, personnel_id, party_id, notes)
  ON public.payment_accounts TO authenticated;
GRANT DELETE ON public.payment_accounts TO authenticated;

GRANT SELECT ON public.sensitive_access_log TO authenticated;                -- RLS: yalnızca admin

GRANT USAGE ON SEQUENCE public.personnel_id_seq, public.payment_accounts_id_seq TO authenticated;

GRANT ALL ON public.personnel, public.payment_accounts, public.sensitive_access_log TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.personnel_id_seq, public.payment_accounts_id_seq,
                                public.sensitive_access_log_id_seq TO service_role;

-- Okuma (hassas olmayan alanlar): şantiye üyeleri (viewer dahil) + admin. Yazma: yalnızca owner/partner.
-- Personel silme: yalnızca şantiye sahibi (silmek puantaj geçmişini de siler; normal çıkış için durum 'ayrildi').
CREATE POLICY personnel_select ON public.personnel FOR SELECT TO authenticated
  USING (private.has_site_access(site_id));
CREATE POLICY personnel_insert ON public.personnel FOR INSERT TO authenticated
  WITH CHECK (private.can_write_site(site_id));
CREATE POLICY personnel_update ON public.personnel FOR UPDATE TO authenticated
  USING (private.can_write_site(site_id)) WITH CHECK (private.can_write_site(site_id));
CREATE POLICY personnel_delete ON public.personnel FOR DELETE TO authenticated
  USING (private.is_site_owner(site_id));

CREATE POLICY payment_accounts_select ON public.payment_accounts FOR SELECT TO authenticated
  USING (private.has_site_access(site_id));
CREATE POLICY payment_accounts_insert ON public.payment_accounts FOR INSERT TO authenticated
  WITH CHECK (private.can_write_site(site_id));
CREATE POLICY payment_accounts_update ON public.payment_accounts FOR UPDATE TO authenticated
  USING (private.can_write_site(site_id)) WITH CHECK (private.can_write_site(site_id));
CREATE POLICY payment_accounts_delete ON public.payment_accounts FOR DELETE TO authenticated
  USING (private.can_write_site(site_id));

CREATE POLICY sensitive_access_log_select ON public.sensitive_access_log FOR SELECT TO authenticated
  USING (private.is_admin());

-- ------------------------------------------------------------
-- RPC: hassas değeri aç (admin veya şantiyenin owner/partner üyesi; viewer HAYIR). Her erişim günlüğe yazılır.
-- ------------------------------------------------------------
CREATE FUNCTION public.reveal_personnel_sensitive(p_personnel_id INTEGER)
RETURNS TABLE (tc_no TEXT, iban TEXT)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_site_id INTEGER;
BEGIN
  SELECT p.site_id INTO v_site_id FROM public.personnel p WHERE p.id = p_personnel_id;

  IF v_site_id IS NULL OR NOT (private.is_admin() OR private.can_write_site(v_site_id)) THEN
    RAISE EXCEPTION 'Bu bilgiyi görme yetkiniz yok.' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.sensitive_access_log (user_id, table_name, record_id, site_id)
  VALUES ((SELECT auth.uid()), 'personnel', p_personnel_id, v_site_id);

  RETURN QUERY SELECT p.tc_no::TEXT, p.iban::TEXT FROM public.personnel p WHERE p.id = p_personnel_id;
END;
$$;

CREATE FUNCTION public.reveal_payment_iban(p_account_id INTEGER)
RETURNS TEXT
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_site_id INTEGER;
  v_iban    TEXT;
BEGIN
  SELECT a.site_id, a.iban INTO v_site_id, v_iban FROM public.payment_accounts a WHERE a.id = p_account_id;

  IF v_site_id IS NULL OR NOT (private.is_admin() OR private.can_write_site(v_site_id)) THEN
    RAISE EXCEPTION 'Bu bilgiyi görme yetkiniz yok.' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.sensitive_access_log (user_id, table_name, record_id, site_id)
  VALUES ((SELECT auth.uid()), 'payment_accounts', p_account_id, v_site_id);

  RETURN v_iban;
END;
$$;

REVOKE ALL ON FUNCTION public.reveal_personnel_sensitive(INTEGER), public.reveal_payment_iban(INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reveal_personnel_sensitive(INTEGER), public.reveal_payment_iban(INTEGER) TO authenticated;
