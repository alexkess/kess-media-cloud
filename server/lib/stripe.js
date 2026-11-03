// Stripe Checkout for invoices, over Stripe's REST API (no SDK).
//   STRIPE_SECRET_KEY=sk_live_...       create Checkout Sessions
//   STRIPE_WEBHOOK_SECRET=whsec_...     verify webhook events
// Webhook endpoint to add in the Stripe dashboard: <PUBLIC_URL>/api/public/stripe/webhook
// events: checkout.session.completed
import { createHmac, timingSafeEqual } from 'node:crypto';

export const stripeEnabled = () => !!process.env.STRIPE_SECRET_KEY;

function form(obj, prefix = '', out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}[${k}]` : k;
    if (v === undefined || v === null) continue;
    if (typeof v === 'object') form(v, key, out);
    else out.append(key, String(v));
  }
  return out;
}

export async function createCheckout(inv, { successUrl, cancelUrl, agencyName }) {
  const body = form({
    mode: 'payment',
    success_url: successUrl,
    cancel_url: cancelUrl,
    client_reference_id: String(inv.id),
    customer_email: inv.client_email || undefined,
    metadata: { invoice_id: inv.id, invoice_number: inv.number },
    payment_intent_data: { description: `${agencyName} invoice ${inv.number}`, metadata: { invoice_id: inv.id, invoice_number: inv.number } },
    line_items: { 0: { quantity: 1, price_data: { currency: 'aud', unit_amount: inv.total_cents, product_data: { name: `Invoice ${inv.number}`, description: `${inv.client_name}, inc GST` } } } },
  });
  const r = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded', 'Idempotency-Key': `inv-${inv.id}-${inv.total_cents}-${Math.floor(Date.now() / 600000)}` },
    body,
    signal: AbortSignal.timeout(15000),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data?.error?.message || `Stripe error ${r.status}`);
  return data;
}

// Stripe-Signature: t=timestamp,v1=hex(hmac_sha256(secret, `${t}.${payload}`))
export function verifyStripeSignature(rawBody, header, secret, toleranceSec = 300, now = Date.now()) {
  if (!header || !secret) return false;
  const parts = Object.fromEntries(String(header).split(',').map((p) => p.split('=').map((x) => x.trim())).filter((p) => p.length === 2 && p[0] !== 'v1'));
  const sigs = String(header).split(',').map((p) => p.trim()).filter((p) => p.startsWith('v1=')).map((p) => p.slice(3));
  const t = Number(parts.t);
  if (!t || !sigs.length || Math.abs(now / 1000 - t) > toleranceSec) return false;
  const expected = createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
  return sigs.some((s) => s.length === expected.length && timingSafeEqual(Buffer.from(s), Buffer.from(expected)));
}
