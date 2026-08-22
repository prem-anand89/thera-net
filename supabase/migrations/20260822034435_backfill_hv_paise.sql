-- ---------------------------------------------------------------------------
-- hv_paise historically bundled TDS into the partner-share figure
-- (billPaise - postTaxPaise instead of billPaise - bmSharePaise) — see
-- src/domain/split.ts. This recomputes every existing row to the corrected
-- formula, including already-invoiced visits — hv_paise is informational
-- only (settlement reconciliation in MonthlyStatementPage uses
-- postTaxPaise, never this column), so a backfill carries no risk to real
-- payout figures.
--
-- protect_invoiced_visit() unconditionally blocks hv_paise changes on an
-- invoiced visit; extend the existing app.allow_invoice_amendment bypass
-- (already used by amend_invoice() for invoice_id re-points) to also cover
-- hv_paise, since correcting this one snapshot field is the same kind of
-- narrow, flag-gated exception — everything else on an invoiced visit
-- stays frozen either way.
-- ---------------------------------------------------------------------------
create or replace function public.protect_invoiced_visit()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if old.invoice_id is not null then
      raise exception 'visit is on issued invoice %; it cannot be deleted', old.invoice_id;
    end if;
    return old;
  end if;
  if old.invoice_id is not null then
    if new.deleted
      or (
        new.invoice_id is distinct from old.invoice_id
        and coalesce(current_setting('app.allow_invoice_amendment', true), '') <> 'true'
      )
      or new.actual_bill_paise is distinct from old.actual_bill_paise
      or new.catalog_price_paise is distinct from old.catalog_price_paise
      or new.adjustment_paise is distinct from old.adjustment_paise
      or new.service_catalog_id is distinct from old.service_catalog_id
      or new.bm_split_pct is distinct from old.bm_split_pct
      or new.tax_pct is distinct from old.tax_pct
      or new.tds_basis is distinct from old.tds_basis
      or new.bm_share_paise is distinct from old.bm_share_paise
      or new.post_tax_paise is distinct from old.post_tax_paise
      or new.tds_paise is distinct from old.tds_paise
      or (
        new.hv_paise is distinct from old.hv_paise
        and coalesce(current_setting('app.allow_invoice_amendment', true), '') <> 'true'
      )
    then
      raise exception 'visit is on issued invoice %; financial fields are frozen', old.invoice_id;
    end if;
  end if;
  return new;
end $$;

select set_config('app.allow_invoice_amendment', 'true', true);
update public.visits
set hv_paise = actual_bill_paise - bm_share_paise
where hv_paise <> (actual_bill_paise - bm_share_paise);
