// Cancels the tutor's subscription at end of the current billing period.
// Stripe will fire customer.subscription.deleted when the period expires,
// which the webhook handler uses to update Supabase — no DB write here.

export const handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeSecretKey) {
    console.error("cancel-subscription: missing STRIPE_SECRET_KEY");
    return { statusCode: 500, body: JSON.stringify({ error: "Server misconfiguration" }) };
  }

  let subscriptionId;
  try {
    ({ subscriptionId } = JSON.parse(event.body ?? "{}"));
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid request body" }) };
  }

  if (!subscriptionId) {
    return { statusCode: 400, body: JSON.stringify({ error: "subscriptionId is required" }) };
  }

  // Stripe API >=2024-09-30.acacia: DELETE cancels immediately and no longer
  // accepts cancel_at_period_end. Use POST (subscription update) instead.
  const res = await fetch(`https://api.stripe.com/v1/subscriptions/${encodeURIComponent(subscriptionId)}`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${stripeSecretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "cancel_at_period_end=true",
  });

  if (!res.ok) {
    const err = await res.json();
    console.error("cancel-subscription: Stripe error:", JSON.stringify(err));
    return { statusCode: 502, body: JSON.stringify({ error: "We couldn't cancel your subscription right now. Please try again, or contact support if this continues." }) };
  }

  const sub = await res.json();
  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      cancelAtPeriodEnd: sub.cancel_at_period_end,
      currentPeriodEnd: sub.current_period_end
        ?? sub.items?.data?.[0]?.current_period_end
        ?? null,
    }),
  };
};
