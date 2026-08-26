import crypto from "crypto";

// Stripe sends the raw body for signature verification — we must not parse it first.
// Netlify provides the raw body as event.body (string) when isBase64Encoded is false.

function verifyStripeSignature(rawBody, sigHeader, secret) {
  // Stripe-Signature: t=<timestamp>,v1=<hmac>,...
  const parts = Object.fromEntries(
    sigHeader.split(",").map((p) => p.split("=", 2)),
  );
  const timestamp = parts["t"];
  const v1 = parts["v1"];
  if (!timestamp || !v1) return false;

  // Reject payloads older than 5 minutes to prevent replay attacks
  const age = Math.floor(Date.now() / 1000) - parseInt(timestamp, 10);
  if (age > 300) return false;

  const signed = `${timestamp}.${rawBody}`;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(signed, "utf8")
    .digest("hex");

  return crypto.timingSafeEqual(Buffer.from(v1, "hex"), Buffer.from(expected, "hex"));
}

function planFromPriceId(priceId) {
  const MONTHLY_PRICE_ID = "price_1U8bLPA4Dt2Idw6NjuisxMSB";
  const ANNUAL_PRICE_ID  = "price_1U8bMxA4Dt2Idw6Nd3bGqmgZ";
  if (priceId === MONTHLY_PRICE_ID) return "monthly";
  if (priceId === ANNUAL_PRICE_ID)  return "annual";
  return null;
}

// Direct PostgREST call — no Supabase client, no WebSocket dependency.
async function patchTutors(supabaseUrl, serviceRoleKey, filter, patch) {
  const [col, val] = Object.entries(filter)[0];
  const url = `${supabaseUrl}/rest/v1/tutors?${col}=eq.${encodeURIComponent(val)}`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      "apikey": serviceRoleKey,
      "Authorization": `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
      "Prefer": "return=minimal",
    },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`PostgREST PATCH failed ${res.status}: ${body}`);
  }
}

export const handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const supabaseUrl    = process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!webhookSecret || !supabaseUrl || !serviceRoleKey) {
    console.error("stripe-webhook: missing required environment variables");
    return { statusCode: 500, body: "Server misconfiguration" };
  }

  const sigHeader = event.headers["stripe-signature"];
  if (!sigHeader) {
    return { statusCode: 400, body: "Missing Stripe-Signature header" };
  }

  const rawBody = event.isBase64Encoded
    ? Buffer.from(event.body, "base64").toString("utf8")
    : event.body;

  let valid;
  try {
    valid = verifyStripeSignature(rawBody, sigHeader, webhookSecret);
  } catch (err) {
    console.error("stripe-webhook: signature verification threw:", err);
    return { statusCode: 400, body: "Signature verification error" };
  }

  if (!valid) {
    console.error("stripe-webhook: invalid signature");
    return { statusCode: 400, body: "Invalid signature" };
  }

  let stripeEvent;
  try {
    stripeEvent = JSON.parse(rawBody);
  } catch {
    return { statusCode: 400, body: "Invalid JSON" };
  }

  const { type, data } = stripeEvent;
  console.log("stripe-webhook: received event", type);

  try {
    if (type === "checkout.session.completed") {
      const session = data.object;
      // client_reference_id is set to the tutor's Supabase UUID at checkout creation.
      const tutorId          = session.client_reference_id;
      const stripeCustomerId = session.customer;
      const stripeSubId      = session.subscription;

      if (!tutorId) {
        console.error("stripe-webhook: checkout.session.completed missing client_reference_id");
        return { statusCode: 200, body: "ok" };
      }

      await patchTutors(supabaseUrl, serviceRoleKey, { id: tutorId }, {
        stripe_customer_id:     stripeCustomerId,
        stripe_subscription_id: stripeSubId,
      });

    } else if (type === "customer.subscription.updated") {
      const sub = data.object;
      const plan = planFromPriceId(sub.items?.data?.[0]?.price?.id);

      await patchTutors(supabaseUrl, serviceRoleKey, { stripe_subscription_id: sub.id }, {
        subscription_status: sub.status,
        subscription_plan:   plan,
        current_period_end:  new Date(sub.current_period_end * 1000).toISOString(),
      });

    } else if (type === "customer.subscription.deleted") {
      const sub = data.object;

      await patchTutors(supabaseUrl, serviceRoleKey, { stripe_subscription_id: sub.id }, {
        subscription_status: "canceled",
      });

    } else {
      // Unrecognised event — log and return 200 so Stripe doesn't retry.
      console.log("stripe-webhook: ignoring unhandled event type:", type);
    }
  } catch (err) {
    console.error("stripe-webhook: unexpected error handling event", type, err);
    // Still return 200 — a 5xx would cause Stripe to retry and hammer the endpoint.
    return { statusCode: 200, body: "ok" };
  }

  return { statusCode: 200, body: "ok" };
};
