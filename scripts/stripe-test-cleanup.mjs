/**
 * stripe-test-cleanup.mjs
 *
 * Lists (and optionally deletes) orphaned Stripe TEST-MODE customers/subscriptions
 * that are no longer referenced by any tutor row in Supabase.
 *
 * Usage:
 *   STRIPE_SECRET_KEY=sk_test_... \
 *   SUPABASE_URL=https://cdskiekviymkessedlem.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=... \
 *   node scripts/stripe-test-cleanup.mjs
 *
 * Add --delete to actually cancel subscriptions and delete customers after
 * you've reviewed the dry-run output:
 *   node scripts/stripe-test-cleanup.mjs --delete
 *
 * Safety guarantees:
 *   - Only touches test-mode data (key must start with sk_test_).
 *   - Never touches a customer/subscription still referenced by a tutor row.
 *   - Dry-run is the default; --delete must be passed explicitly.
 */

const DRY_RUN = !process.argv.includes("--delete");

const STRIPE_KEY = process.env.STRIPE_SECRET_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// ── Validation ────────────────────────────────────────────────────────────────

if (!STRIPE_KEY || !SUPABASE_URL || !SUPABASE_KEY) {
  console.error(
    "Missing env vars. Set STRIPE_SECRET_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.",
  );
  process.exit(1);
}

if (!STRIPE_KEY.startsWith("sk_test_")) {
  console.error("STRIPE_SECRET_KEY does not look like a test-mode key (must start with sk_test_). Aborting.");
  process.exit(1);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function stripeGet(path) {
  const results = [];
  let url = `https://api.stripe.com/v1/${path}?limit=100`;
  while (url) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${STRIPE_KEY}` },
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(`Stripe GET ${path} failed: ${err?.error?.message}`);
    }
    const body = await res.json();
    results.push(...body.data);
    url = body.has_more ? `https://api.stripe.com/v1/${path}?limit=100&starting_after=${body.data.at(-1).id}` : null;
  }
  return results;
}

async function stripePost(path, params) {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${STRIPE_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(params).toString(),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(`Stripe POST ${path} failed: ${err?.error?.message}`);
  }
  return res.json();
}

async function stripeDelete(path) {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${STRIPE_KEY}` },
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(`Stripe DELETE ${path} failed: ${err?.error?.message}`);
  }
  return res.json();
}

async function supabaseGet(table, select) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/${table}?select=${select}`,
    {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
      },
    },
  );
  if (!res.ok) throw new Error(`Supabase GET ${table} failed: ${await res.text()}`);
  return res.json();
}

// ── Main ──────────────────────────────────────────────────────────────────────

console.log(`\n${"═".repeat(60)}`);
console.log(`  Stripe test-mode cleanup — ${DRY_RUN ? "DRY RUN (read-only)" : "⚠️  LIVE DELETE MODE"}`);
console.log(`${"═".repeat(60)}\n`);

// 1. Load tutor references from Supabase
console.log("1. Loading tutor Stripe references from Supabase…");
const tutors = await supabaseGet(
  "tutors",
  "id,stripe_customer_id,stripe_subscription_id,subscription_status",
);
const liveCustomerIds = new Set(
  tutors.map((t) => t.stripe_customer_id).filter(Boolean),
);
const liveSubIds = new Set(
  tutors.map((t) => t.stripe_subscription_id).filter(Boolean),
);
console.log(
  `   Found ${tutors.length} tutor rows. ` +
  `${liveCustomerIds.size} unique customer IDs, ${liveSubIds.size} unique subscription IDs referenced.\n`,
);

// 2. Load all Stripe test-mode customers
console.log("2. Fetching all Stripe test-mode customers…");
const allCustomers = await stripeGet("customers");
console.log(`   ${allCustomers.length} customers in Stripe test mode.\n`);

// 3. Load all Stripe test-mode subscriptions
console.log("3. Fetching all Stripe test-mode subscriptions…");
const allSubs = await stripeGet("subscriptions?status=all");
console.log(`   ${allSubs.length} subscriptions in Stripe test mode.\n`);

// 4. Cross-reference
const orphanedSubs = allSubs.filter((s) => !liveSubIds.has(s.id));
const orphanedCustomers = allCustomers.filter((c) => !liveCustomerIds.has(c.id));

// ── Report ────────────────────────────────────────────────────────────────────

console.log("─".repeat(60));
console.log(`ORPHANED SUBSCRIPTIONS (${orphanedSubs.length})`);
console.log("─".repeat(60));
if (orphanedSubs.length === 0) {
  console.log("  None.");
} else {
  for (const s of orphanedSubs) {
    console.log(
      `  ${s.id}  status=${s.status}  customer=${s.customer}  ` +
      `created=${new Date(s.created * 1000).toISOString().slice(0, 10)}`,
    );
  }
}

console.log();
console.log("─".repeat(60));
console.log(`ORPHANED CUSTOMERS (${orphanedCustomers.length})`);
console.log("─".repeat(60));
if (orphanedCustomers.length === 0) {
  console.log("  None.");
} else {
  for (const c of orphanedCustomers) {
    console.log(
      `  ${c.id}  email=${c.email ?? "(none)"}  ` +
      `created=${new Date(c.created * 1000).toISOString().slice(0, 10)}`,
    );
  }
}

console.log();
console.log("─".repeat(60));
console.log(`LIVE (KEEPING — referenced by tutor rows): ${liveCustomerIds.size} customers, ${liveSubIds.size} subscriptions`);
console.log("─".repeat(60));
for (const t of tutors.filter((t) => t.stripe_customer_id || t.stripe_subscription_id)) {
  console.log(
    `  tutor ${t.id.slice(0, 8)}…  status=${t.subscription_status ?? "null"}` +
    `  cus=${t.stripe_customer_id ?? "—"}  sub=${t.stripe_subscription_id ?? "—"}`,
  );
}

// ── Delete (only if --delete passed) ─────────────────────────────────────────

if (DRY_RUN) {
  console.log(`\n${"═".repeat(60)}`);
  console.log("  DRY RUN complete — nothing was changed.");
  console.log("  Review the list above, then re-run with --delete to apply.");
  console.log(`${"═".repeat(60)}\n`);
  process.exit(0);
}

// Cancel orphaned subscriptions first (can't delete a customer with active sub)
if (orphanedSubs.length > 0) {
  console.log(`\nCancelling ${orphanedSubs.length} orphaned subscription(s)…`);
  for (const s of orphanedSubs) {
    if (s.status === "canceled") {
      console.log(`  skip  ${s.id} (already canceled)`);
      continue;
    }
    try {
      await stripePost(`subscriptions/${s.id}/cancel`, {});
      console.log(`  ✓ canceled  ${s.id}`);
    } catch (err) {
      console.error(`  ✗ ${s.id}: ${err.message}`);
    }
  }
}

// Delete orphaned customers
if (orphanedCustomers.length > 0) {
  console.log(`\nDeleting ${orphanedCustomers.length} orphaned customer(s)…`);
  for (const c of orphanedCustomers) {
    try {
      await stripeDelete(`customers/${c.id}`);
      console.log(`  ✓ deleted  ${c.id}  ${c.email ?? ""}`);
    } catch (err) {
      console.error(`  ✗ ${c.id}: ${err.message}`);
    }
  }
}

console.log(`\n${"═".repeat(60)}`);
console.log("  Cleanup complete.");
console.log(`${"═".repeat(60)}\n`);
