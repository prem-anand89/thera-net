-- Clinic UPI collection: one VPA + optional static QR image for the whole
-- clinic. Used to show a scan-to-pay sheet on New visit / Take payment when
-- the staff pick UPI. Dynamic QR is generated client-side from the VPA;
-- the image is a fallback when no VPA is set.
alter table public.clinics
  add column if not exists upi_vpa text,
  add column if not exists upi_payee_name text,
  add column if not exists upi_qr_path text,
  add column if not exists upi_qr_enabled boolean not null default false;
