// While payments are disabled every user is shown (and treated as) Premium. The stored
// tier in the DB is left untouched, so flipping PAYMENTS_ENABLED back on restores
// each user's real plan.
export const PAYMENTS_ENABLED = process.env.PAYMENTS_ENABLED === 'true';

export function shownTier(tier) {
  return PAYMENTS_ENABLED ? (tier || 'Free') : 'Premium';
}
