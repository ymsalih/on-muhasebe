-- ============================================================
-- KİRA ÖDEMESİ ↔ PUANTAJ OTOMATİK SENKRON
-- Bir kiralık makinenin o ayki kira ödemeleri puantajla TAM uyumluysa (ödenen miktar = puantajdaki gün/saat), puantaj
-- değişince (gün işareti eklenir/kaldırılır, saat değişir) ödeme de AYNI İŞLEMDE güncellenir:
--   * miktar (gün/saat) delta kadar değişir, tutar = miktar × birim kira yeniden hesaplanır, açıklamadaki miktar düzeltilir;
--   * artış en yeni ödemeye eklenir, azalış en yeni ödemeden düşülür; bir ödemenin tamamı puantajdan çıkarsa o ödeme silinir
--     ve kalan azalış bir önceki ödemeye uygulanır.
-- Kısmi ödemelere (ödenen ≠ puantaj) ve döküm temizlenmiş (miktar boş) ödemesi olan aylara DOKUNULMAZ.
-- Tek bir işlemde (aynı makine, aynı ay) en çok bir puantaj satırı değişir (arayüz böyle çalışır).
-- ============================================================

CREATE FUNCTION private.sync_machine_rental()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  rec          public.machine_attendance;
  m            public.machines;
  delta        NUMERIC := 0;
  month_start  DATE;
  month_end    DATE;
  worked_after NUMERIC;
  paid         NUMERIC;
  broken       INTEGER;
  p            RECORD;
  remaining    NUMERIC;
  new_qty      NUMERIC;
  qty_text     TEXT;
BEGIN
  -- CASCADE silmelerde (makine/şantiye silinirken) ödemeye dokunma
  IF pg_trigger_depth() > 1 THEN
    RETURN NULL;
  END IF;

  rec := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  SELECT * INTO m FROM public.machines WHERE id = rec.machine_id AND site_id = rec.site_id;
  IF NOT FOUND OR m.ownership <> 'rented' OR m.rate_unit IS NULL THEN
    RETURN NULL;
  END IF;

  IF m.rate_unit = 'day' THEN
    delta := CASE TG_OP WHEN 'INSERT' THEN 1 WHEN 'DELETE' THEN -1 ELSE 0 END;
  ELSE
    delta := CASE TG_OP
      WHEN 'INSERT' THEN COALESCE(NEW.hours, 0)
      WHEN 'DELETE' THEN -COALESCE(OLD.hours, 0)
      ELSE COALESCE(NEW.hours, 0) - COALESCE(OLD.hours, 0)
    END;
  END IF;
  IF delta = 0 THEN
    RETURN NULL;
  END IF;

  month_start := date_trunc('month', rec.work_date)::date;
  month_end   := (month_start + INTERVAL '1 month - 1 day')::date;

  IF m.rate_unit = 'day' THEN
    SELECT COUNT(*) INTO worked_after FROM public.machine_attendance a
    WHERE a.machine_id = m.id AND a.work_date BETWEEN month_start AND month_end;
  ELSE
    SELECT COALESCE(SUM(a.hours), 0) INTO worked_after FROM public.machine_attendance a
    WHERE a.machine_id = m.id AND a.work_date BETWEEN month_start AND month_end;
  END IF;

  -- Döküm temizlenmiş (miktarı boş) ödemesi olan ay: ne kadarının puantaja bağlı olduğu bilinmez → dokunma
  SELECT COUNT(*) INTO broken FROM public.transactions t
  WHERE t.site_id = m.site_id AND t.machine_id = m.id AND t.user_id = m.owner_id AND t.period_month = month_start AND t.machine_qty IS NULL;
  IF broken > 0 THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(SUM(t.machine_qty), 0) INTO paid FROM public.transactions t
  WHERE t.site_id = m.site_id AND t.machine_id = m.id AND t.user_id = m.owner_id AND t.period_month = month_start AND t.machine_unit = m.rate_unit;

  -- Değişiklikten ÖNCE ödeme puantajla tam uyumlu muydu? (ödenen = puantaj − delta)
  IF paid <= 0 OR ABS(paid - (worked_after - delta)) >= 0.05 THEN
    RETURN NULL;
  END IF;

  remaining := delta;
  FOR p IN
    SELECT t.id, t.machine_qty, t.machine_rate, t.description FROM public.transactions t
    WHERE t.site_id = m.site_id AND t.machine_id = m.id AND t.user_id = m.owner_id AND t.period_month = month_start AND t.machine_unit = m.rate_unit
    ORDER BY t.transaction_date DESC, t.id DESC
  LOOP
    EXIT WHEN remaining = 0;
    new_qty := p.machine_qty + remaining;
    IF new_qty > 0 THEN
      qty_text := replace(trim_scale(new_qty)::text, '.', ',');
      UPDATE public.transactions
      SET machine_qty = new_qty,
          amount = ROUND(new_qty * p.machine_rate, 2),
          description = regexp_replace(p.description, '\([0-9]+(,[0-9]+)? (gün|saat) ×', '(' || qty_text || ' ' || (CASE WHEN m.rate_unit = 'day' THEN 'gün' ELSE 'saat' END) || ' ×')
      WHERE id = p.id;
      remaining := 0;
    ELSE
      -- Bu ödemenin tamamı artık puantajda yok: sil, kalan azalışı bir önceki ödemeye uygula
      remaining := new_qty;
      DELETE FROM public.transactions WHERE id = p.id;
    END IF;
  END LOOP;

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION private.sync_machine_rental() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER machine_attendance_sync_rental
  AFTER INSERT OR DELETE OR UPDATE OF hours ON public.machine_attendance
  FOR EACH ROW EXECUTE FUNCTION private.sync_machine_rental();
