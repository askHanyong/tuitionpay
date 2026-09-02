// Creates a Stripe Checkout Session for tutor subscription billing.
// Called from the frontend with { plan: "monthly" | "annual", tutorId: "<uuid>" }.
// Returns { url } — the frontend redirects the browser to that URL.

const PRICE_IDS = {
  monthly: "price_1UAs8cA4Dt2Idw6NZ2jvhEHN",
  annual:  "price_1UAsA2A4Dt2Idw6Neq1QvxM1",
};

export const handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  const siteUrl         = process.env.URL; // Netlify injects this automatically

  if (!stripeSecretKey || !siteUrl) {
    console.error("create-checkout-session: missing STRIPE_SECRET_KEY or URL env var");
    return { statusCode: 500, body: JSON.stringify({ error: "Server misconfiguration" }) };
  }

  let plan, tutorId;
  try {
    ({ plan, tutorId } = JSON.parse(event.body ?? "{}"));
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid request body" }) };
  }

  if (!plan || !PRICE_IDS[plan]) {
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid plan. Must be 'monthly' or 'annual'." }) };
  }
  if (!tutorId) {
    return { statusCode: 400, body: JSON.stringify({ error: "tutorId is required" }) };
  }

  const priceId = PRICE_IDS[plan];

  const params = new URLSearchParams({
    "mode": "subscription",
    "line_items[0][price]": priceId,
    "line_items[0][quantity]": "1",
    "client_reference_id": tutorId,
    "subscription_data[metadata][tutor_id]": tutorId,
    "success_url": `${siteUrl}/?checkout=success`,
    "cancel_url":  `${siteUrl}/?checkout=canceled`,
  });

  const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${stripeSecretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });

  if (!response.ok) {
    const err = await response.json();
    console.error("create-checkout-session: Stripe error:", JSON.stringify(err));
    return {
      statusCode: 502,
      body: JSON.stringify({ error: "We couldn't start checkout right now. Please try again, or contact support if this continues." }),
    };
  }

  const session = await response.json();
  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: session.url }),
  };
};
