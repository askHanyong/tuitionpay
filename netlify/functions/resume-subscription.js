// Resumes a subscription that was set to cancel_at_period_end=true.
// Triggers customer.subscription.updated, which resets cancel_at_period_end in Supabase.

export const handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeSecretKey) {
    console.error("resume-subscription: missing STRIPE_SECRET_KEY");
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

  const res = await fetch(`https://api.stripe.com/v1/subscriptions/${encodeURIComponent(subscriptionId)}`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${stripeSecretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "cancel_at_period_end=false",
  });

  if (!res.ok) {
    const err = await res.json();
    console.error("resume-subscription: Stripe error:", JSON.stringify(err));
    return { statusCode: 502, body: JSON.stringify({ error: "We couldn't resume your subscription right now. Please try again, or contact support if this continues." }) };
  }

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ok: true }),
  };
};
