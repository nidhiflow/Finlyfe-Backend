import cron from 'node-cron';
import { query } from '../db/index.js';

function computeNextDue(currentDue, frequency, interval) {
  const d = new Date(currentDue);
  const step = interval || 1;
  if (frequency === 'daily' || frequency === 'days') d.setDate(d.getDate() + step);
  else if (frequency === 'weekly' || frequency === 'weeks') d.setDate(d.getDate() + 7 * step);
  else if (frequency === 'monthly' || frequency === 'months') d.setMonth(d.getMonth() + step);
  else if (frequency === 'quarterly') d.setMonth(d.getMonth() + 3);
  else if (frequency === 'yearly' || frequency === 'years') d.setFullYear(d.getFullYear() + step);
  return d;
}

// Processes every active recurring template, creating one child transaction per
// occurrence missed so far and looping until it's caught up to the present —
// this matters because the host process can sleep/restart between cron ticks,
// so a single template may have several occurrences due by the time we run.
export async function processRecurringTransactions() {
  console.log('[CRON] Running recurrence worker at', new Date().toISOString());
  try {
    const now = new Date();
    const { rows: templates } = await query(`
      SELECT * FROM transactions
      WHERE is_recurring = true
        AND status = 'active'
        AND auto_create = true
        AND next_due_date IS NOT NULL
        AND next_due_date <= $1
    `, [now.toISOString()]);

    console.log(`[CRON] Found ${templates.length} recurring transactions due.`);

    for (const t of templates) {
      try {
        let currentDue = t.next_due_date;
        let occurrencesCreated = 0;
        let nextStatus = t.status;
        let nextCount = t.repeat_occurrences_current || 0;

        while (new Date(currentDue) <= now && nextStatus === 'active') {
          const newTxId = Date.now().toString() + Math.floor(Math.random() * 1000) + occurrencesCreated;

          await query(`
            INSERT INTO transactions (
              id, user_id, type, amount, category_id, subcategory_id, account_id, to_account_id,
              title, note, date, photo, is_recurring, repeat_group_id
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, false, $13)
          `, [
            newTxId, t.user_id, t.type, t.amount, t.category_id, t.subcategory_id, t.account_id, t.to_account_id,
            t.title, t.note, currentDue, t.photo, t.id
          ]);
          occurrencesCreated++;

          const nextDueDate = computeNextDue(currentDue, t.repeat_frequency, t.repeat_interval);
          const nextDue = nextDueDate.toISOString();
          nextCount += 1;

          if (t.repeat_end_type === 'on_date' && t.repeat_end_date && nextDue > t.repeat_end_date) {
            nextStatus = 'completed';
          } else if (t.repeat_end_type === 'after_n' && t.repeat_occurrences_total && nextCount >= t.repeat_occurrences_total) {
            nextStatus = 'completed';
          }

          currentDue = nextDue;
        }

        await query(`
          UPDATE transactions
          SET next_due_date = $1, repeat_occurrences_current = $2, status = $3
          WHERE id = $4
        `, [currentDue, nextCount, nextStatus, t.id]);

        console.log(`[CRON] Template ${t.id}: created ${occurrencesCreated} occurrence(s), caught up to next due ${currentDue}, status: ${nextStatus}`);
      } catch (innerErr) {
        console.error(`[CRON] Failed to process template ${t.id}:`, innerErr);
      }
    }
  } catch (err) {
    console.error('[CRON] Recurrence worker error:', err);
  }
}

export function initRecurrenceCron() {
  // Run immediately on boot so a cold start / wake-up from sleep catches up
  // right away instead of waiting for the next scheduled tick.
  processRecurringTransactions();

  // Then keep checking every 15 minutes — finer-grained than hourly so a
  // process that's only briefly awake still has a good chance of catching it.
  cron.schedule('*/15 * * * *', () => {
    processRecurringTransactions();
  });
}
