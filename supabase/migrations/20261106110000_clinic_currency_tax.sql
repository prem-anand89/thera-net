-- Global readiness (foundations plan, G5): the clinic's currency and tax regime, STORED ONLY.
-- Nothing in the app reads these yet. A picker, and screens that honour them, wait until every screen goes through
-- formatAmount / currencySymbol() (done) and a clinic outside India is signed. Until then every clinic is INR and
-- GST_IN, which is what every screen already assumes. Do not change these per clinic by hand: a clinic set to GBP
-- would still see rupees everywhere.
-- Money columns keep their *_paise names and mean 1/100 of the clinic's currency (currencies without 100 minor units
-- are out of scope by design).
alter table public.clinics
  add column if not exists currency_code text not null default 'INR'
    check (currency_code in ('INR', 'USD', 'GBP', 'EUR', 'AED', 'AUD', 'CAD', 'SGD')),
  add column if not exists tax_regime text not null default 'GST_IN'
    check (tax_regime in ('GST_IN', 'GENERIC_TAX', 'NO_TAX'));
