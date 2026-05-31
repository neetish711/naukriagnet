import { NextResponse } from 'next/server';
import { SheetsClient } from '@/lib/sheets/client';
import { GmailClient } from '@/lib/gmail/client';
import { loadConfig, loadProfile } from '@/config';
import { logger } from '@/lib/logger';

const sheetsClient = new SheetsClient();

export async function POST() {
  try {
    const config = loadConfig();
    const profile = loadProfile();
    const gmailClient = new GmailClient(sheetsClient);
    const all = await sheetsClient.getAllOpportunities();

    const approved = all.filter(
      (op) => op.status === 'approved' && op.email && op.generatedEmail && op.rowIndex
    );

    const today = new Date().toDateString();
    const sentToday = all.filter(
      (op) => op.status === 'sent' && op.sentDate && new Date(op.sentDate).toDateString() === today
    ).length;

    const remaining = config.email.dailySendLimit - sentToday;
    if (remaining <= 0) {
      return NextResponse.json({ success: false, error: 'Daily send limit reached', sent: 0, failed: 0 });
    }

    const toSend = approved.slice(0, remaining);
    let sent = 0;
    let failed = 0;

    for (const op of toSend) {
      const result = await gmailClient.sendEmail(op, profile.resumePath);
      if (result.success) {
        sent++;
        await sheetsClient.updateRow(op.rowIndex!, {
          status: 'sent',
          sentDate: new Date().toISOString(),
          messageId: result.messageId || '',
        });
      } else {
        failed++;
        await sheetsClient.updateRow(op.rowIndex!, {
          status: 'failed',
          notes: result.error || 'Send failed',
        });
      }

      await new Promise((r) => setTimeout(r, config.email.delayBetweenEmailsMs));
    }

    logger.info('Send batch complete', { sent, failed });
    return NextResponse.json({ success: true, sent, failed, remaining: remaining - sent });
  } catch (err) {
    logger.error('Send batch failed', { error: err });
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}
