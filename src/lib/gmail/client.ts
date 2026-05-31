import { google, gmail_v1 } from 'googleapis';
import { SheetsClient } from '@/lib/sheets/client';
import fs from 'fs';
import path from 'path';
import { logger } from '@/lib/logger';
import type { Opportunity, EmailSendResult } from '@/types';

export class GmailClient {
  private gmail: gmail_v1.Gmail;
  private senderEmail: string;

  constructor(sheetsClient: SheetsClient) {
    const auth = sheetsClient.getAuth();
    this.gmail = google.gmail({ version: 'v1', auth });
    this.senderEmail = process.env.GMAIL_SENDER_EMAIL || '';
  }

  private encodeEmail(to: string, subject: string, body: string, attachmentPath?: string): string {
    const boundary = `boundary_${Date.now()}`;
    const hasAttachment = attachmentPath && fs.existsSync(attachmentPath);

    let raw: string;

    if (hasAttachment) {
      const attachmentData = fs.readFileSync(attachmentPath!);
      const base64Attachment = attachmentData.toString('base64');
      const filename = path.basename(attachmentPath!);

      raw = [
        `From: ${this.senderEmail}`,
        `To: ${to}`,
        `Subject: ${subject}`,
        'MIME-Version: 1.0',
        `Content-Type: multipart/mixed; boundary="${boundary}"`,
        '',
        `--${boundary}`,
        'Content-Type: text/plain; charset=UTF-8',
        '',
        body,
        '',
        `--${boundary}`,
        `Content-Type: application/octet-stream; name="${filename}"`,
        `Content-Disposition: attachment; filename="${filename}"`,
        'Content-Transfer-Encoding: base64',
        '',
        base64Attachment,
        '',
        `--${boundary}--`,
      ].join('\r\n');
    } else {
      raw = [
        `From: ${this.senderEmail}`,
        `To: ${to}`,
        `Subject: ${subject}`,
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=UTF-8',
        '',
        body,
      ].join('\r\n');
    }

    return Buffer.from(raw).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  async sendEmail(opportunity: Opportunity, resumePath: string): Promise<EmailSendResult> {
    if (!opportunity.email) {
      return { success: false, error: 'No email address found' };
    }
    if (!opportunity.generatedEmail) {
      return { success: false, error: 'No generated email content' };
    }

    try {
      const encoded = this.encodeEmail(
        opportunity.email,
        opportunity.generatedSubject,
        opportunity.generatedEmail,
        resumePath
      );

      const res = await this.gmail.users.messages.send({
        userId: 'me',
        requestBody: { raw: encoded },
      });

      logger.info('Email sent', { to: opportunity.email, messageId: res.data.id });
      return { success: true, messageId: res.data.id || undefined };
    } catch (err) {
      logger.error('Failed to send email', { error: err, to: opportunity.email });
      return { success: false, error: String(err) };
    }
  }

  async checkReplies(messageIds: string[]): Promise<string[]> {
    const repliedIds: string[] = [];
    for (const msgId of messageIds) {
      try {
        const thread = await this.gmail.users.messages.get({
          userId: 'me',
          id: msgId,
          format: 'metadata',
        });
        const threadId = thread.data.threadId;
        if (threadId) {
          const threadData = await this.gmail.users.threads.get({
            userId: 'me',
            id: threadId,
            format: 'metadata',
          });
          const messages = threadData.data.messages || [];
          if (messages.length > 1) repliedIds.push(msgId);
        }
      } catch {
        // Skip errors
      }
    }
    return repliedIds;
  }
}
