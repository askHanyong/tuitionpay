// Switches the tutor's subscription between monthly and annual plans.
// Uses Stripe's default create_prorations behavior.
// Triggers customer.subscription.updated webhook, which updates Supabase.

const PRICE_IDS = {
  monthly: "price_1U8bLPA4Dt2Idw6NjuisxMSB",
  annual:  "price_1U8bMxA4Dt2Idw6Nd3bGqmgZ",
};

export const handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeSecretKey) {
    console.error("switch-plan: missing STRIPE_SECRET_KEY");
    return { statusCode: 500, body: JSON.stringify({ error: "Server misconfiguration" }) };
  }

  let subscriptionId, newPlan;
  try {
    ({ subscriptionId, newPlan } = JSON.parse(event.body ?? "{}"));
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid request body" }) };
  }

  if (!subscriptionId) {
    return { statusCode: 400, body: JSON.stringify({ error: "subscriptionId is required" }) };
  }
  if (!newPlan || !PRICE_IDS[newPlan]) {
    return { statusCode: 400, body: JSON.stringify({ error: "newPlan must be 'monthly' or 'annual'" }) };
  }

  // Fetch the current subscription to get the subscription item ID.
  const getRes = await fetch(`https://api.stripe.com/v1/subscriptions/${encodeURIComponent(subscriptionId)}`, {
    headers: { "Authorization": `Bearer ${stripeSecretKey}` },
  });
  if (!getRes.ok) {
    const err = await getRes.json();
    console.error("switch-plan: Stripe GET error:", err);
    return { statusCode: 502, body: JSON.stringify({ error: err?.error?.message ?? "Stripe error" }) };
  }
  const currentSub = await getRes.json();
  const itemId = currentSub.items?.data?.[0]?.id;
  if (!itemId) {
    return { statusCode: 400, body: JSON.stringify({ error: "No subscription item found" }) };
  }

  // Update the subscription item to the new price with default proration.
  const params = new URLSearchParams({
    [`items[0][id]`]:    itemId,
    [`items[0][price]`]: PRICE_IDS[newPlan],
    "proration_behavior": "create_prorations",
  });

  const updateRes = await fetch(`https://api.stripe.com/v1/subscriptions/${encodeURIComponent(subscriptionId)}`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${stripeSecretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });

  if (!updateRes.ok) {
    const err = await updateRes.json();
    console.error("switch-plan: Stripe POST error:", err);
    return { statusCode: 502, body: JSON.stringify({ error: err?.error?.message ?? "Stripe error" }) };
  }

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ok: true }),
  };
};
