import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";

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
  const MONTHLY_PRICE_ID = "price_1U8bc7PBgRn72RPYG4HQvbx7";
  const ANNUAL_PRICE_ID  = "price_1U8bd7PBgRn72RPYjiLoNC9X";
  if (priceId === MONTHLY_PRICE_ID) return "monthly";
  if (priceId === ANNUAL_PRICE_ID)  return "annual";
  return null;
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

  // Use the service-role client — bypasses RLS so we can write to any tutor row.
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const { type, data } = stripeEvent;
  console.log("stripe-webhook: received event", type);

  try {
    if (type === "checkout.session.completed") {
      const session = data.object;
      // client_reference_id must be set to the tutor's Supabase UUID at checkout creation time.
      const tutorId           = session.client_reference_id;
      const stripeCustomerId  = session.customer;
      const stripeSubId       = session.subscription;

      if (!tutorId) {
        console.error("stripe-webhook: checkout.session.completed missing client_reference_id");
        return { statusCode: 200, body: "ok" };
      }

      const { error } = await supabase
        .from("tutors")
        .update({
          stripe_customer_id:    stripeCustomerId,
          stripe_subscription_id: stripeSubId,
        })
        .eq("id", tutorId);

      if (error) console.error("stripe-webhook: DB update failed (checkout):", error);

    } else if (type === "customer.subscription.updated") {
      const sub = data.object;
      const plan = planFromPriceId(sub.items?.data?.[0]?.price?.id);

      const { error } = await supabase
        .from("tutors")
        .update({
          subscription_status:  sub.status,
          subscription_plan:    plan,
          current_period_end:   new Date(sub.current_period_end * 1000).toISOString(),
        })
        .eq("stripe_subscription_id", sub.id);

      if (error) console.error("stripe-webhook: DB update failed (sub updated):", error);

    } else if (type === "customer.subscription.deleted") {
      const sub = data.object;

      const { error } = await supabase
        .from("tutors")
        .update({ subscription_status: "canceled" })
        .eq("stripe_subscription_id", sub.id);

      if (error) console.error("stripe-webhook: DB update failed (sub deleted):", error);

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
