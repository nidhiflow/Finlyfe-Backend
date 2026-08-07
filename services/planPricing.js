// Server-side source of truth for what each subscription plan costs.
// create-order / create-qr derive the charge amount from here instead of trusting
// the client, and verify-payment grants whatever plan is on the matching payments row.
// Only plans actually sold through checkout belong here — "Pro" is currently
// admin-assignable only (see routes/admin.js) and has no listed price, so it is
// intentionally absent until a real price is defined.
export const PLAN_PRICES = {
  Premium: {
    monthly: 9900,   // ₹99.00 in paise
    yearly: 99900,   // ₹999.00 in paise
  },
};

export function getPlanAmount(plan, billingCycle) {
  const planPrices = PLAN_PRICES[plan];
  if (!planPrices) return null;

  const cycle = billingCycle === 'yearly' ? 'yearly' : 'monthly';
  const amount = planPrices[cycle];
  if (!amount) return null;

  return { amount, billingCycle: cycle };
}
