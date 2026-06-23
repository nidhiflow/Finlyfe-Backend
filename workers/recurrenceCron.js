import cron from 'node-cron';
import { query } from '../db/index.js';

export function initRecurrenceCron() {
  // Run every hour. For production, usually runs daily at midnight e.g., '0 0 * * *'
  // But running hourly or even minutely in development is helpful for testing.
  cron.schedule('0 * * * *', async () => {
    console.log('[CRON] Running recurrence worker at', new Date().toISOString());
    try {
      // Find active templates that are due today or earlier
      const { rows: templates } = await query(`
        SELECT * FROM transactions 
        WHERE is_recurring = true 
          AND status = 'active'
          AND auto_create = true
          AND next_due_date IS NOT NULL
          AND next_due_date <= $1
      `, [new Date().toISOString()]);

      console.log(`[CRON] Found ${templates.length} recurring transactions due.`);

      for (const t of templates) {
        try {
          // Generate new transaction ID
          const newTxId = Date.now().toString() + Math.floor(Math.random() * 1000);
          const currentDue = t.next_due_date;

          // 1. Insert child transaction
          await query(`
            INSERT INTO transactions (
              id, user_id, type, amount, category_id, subcategory_id, account_id, to_account_id, 
              title, note, date, photo, is_recurring, repeat_group_id
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, false, $13)
          `, [
            newTxId, t.user_id, t.type, t.amount, t.category_id, t.subcategory_id, t.account_id, t.to_account_id,
            t.title, t.note, currentDue, t.photo, t.id // Link child to parent via repeat_group_id
          ]);

          // 2. Calculate next due date
          const d = new Date(currentDue);
          const interval = t.repeat_interval || 1;
          if (t.repeat_frequency === 'daily' || t.repeat_frequency === 'days') d.setDate(d.getDate() + interval);
          else if (t.repeat_frequency === 'weekly' || t.repeat_frequency === 'weeks') d.setDate(d.getDate() + 7 * interval);
          else if (t.repeat_frequency === 'monthly' || t.repeat_frequency === 'months') d.setMonth(d.getMonth() + interval);
          else if (t.repeat_frequency === 'quarterly') d.setMonth(d.getMonth() + 3);
          else if (t.repeat_frequency === 'yearly' || t.repeat_frequency === 'years') d.setFullYear(d.getFullYear() + interval);
          
          const nextDue = d.toISOString();
          const nextCount = (t.repeat_occurrences_current || 0) + 1;
          
          // 3. Determine if completed
          let newStatus = t.status;
          if (t.repeat_end_type === 'on_date' && t.repeat_end_date && nextDue > t.repeat_end_date) {
            newStatus = 'completed';
          } else if (t.repeat_end_type === 'after_n' && t.repeat_occurrences_total && nextCount >= t.repeat_occurrences_total) {
            newStatus = 'completed';
          }

          // 4. Update parent
          await query(`
            UPDATE transactions 
            SET next_due_date = $1, repeat_occurrences_current = $2, status = $3
            WHERE id = $4
          `, [nextDue, nextCount, newStatus, t.id]);

          console.log(`[CRON] Processed child Tx ${newTxId} for template ${t.id}. Next due: ${nextDue}. Status: ${newStatus}`);

        } catch (innerErr) {
          console.error(`[CRON] Failed to process template ${t.id}:`, innerErr);
        }
      }
    } catch (err) {
      console.error('[CRON] Recurrence worker error:', err);
    }
  });
}
