-- [effective_date, end_date) may be empty when a retainer is cancelled on
-- its first business date. Keep finite dates and reject reversed periods.
-- The existing GiST exclusion constraint continues to prevent real overlaps.
alter table public.customer_billing_agreements
  drop constraint customer_billing_agreements_dates_valid,
  add constraint customer_billing_agreements_dates_valid
    check (
      isfinite(effective_date)
      and (end_date is null or (isfinite(end_date) and end_date >= effective_date))
    );
