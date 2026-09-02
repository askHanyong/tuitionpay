-- Stores Stripe invoice records for each successful subscription charge.
-- Populated by the stripe-webhook function on invoice.payment_succeeded events.
-- tutor_id references the tutors table; no FK constraint to keep deletes simple.

CREATE TABLE IF NOT EXISTS stripe_invoices (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tutor_id            uuid NOT NULL,
  stripe_invoice_id   text NOT NULL UNIQUE,
  amount_paid         integer NOT NULL,   -- in cents (SGD)
  currency            text NOT NULL DEFAULT 'sgd',
  hosted_invoice_url  text,
  invoice_pdf         text,
  period_start        timestamptz,
  period_end          timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS stripe_invoices_tutor_id_idx ON stripe_invoices (tutor_id, created_at DESC);

ALTER TABLE stripe_invoices ENABLE ROW LEVEL SECURITY;

-- Tutors can only read their own invoices.
CREATE POLICY "Tutors read own invoices"
  ON stripe_invoices FOR SELECT
  USING (tutor_id = auth.uid());
