import { google, sheets_v4 } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import fs from 'fs';
import path from 'path';
import { logger } from '@/lib/logger';
import type { Opportunity } from '@/types';

const TOKEN_PATH = path.join(process.cwd(), 'data', 'sessions', 'sheets-token.json');
const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.readonly',
];

const SHEET_HEADERS = [
  'ID', 'Date', 'Company', 'Recruiter Name', 'Recruiter Profile URL',
  'Email', 'Job Title', 'Post URL', 'Post Date', 'Post Content',
  'Relevance Score', 'Relevance Reason', 'Status',
  'Generated Subject', 'Generated Email',
  'Sent Date', 'Message ID', 'Notes'
];

export class SheetsClient {
  private auth: OAuth2Client;
  private sheets: sheets_v4.Sheets;
  private spreadsheetId: string;
  private sheetName: string;

  constructor() {
    this.auth = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/api/gmail/callback'
    );
    this.sheets = google.sheets({ version: 'v4', auth: this.auth });
    this.spreadsheetId = process.env.GOOGLE_SHEET_ID || '';
    this.sheetName = 'Applications';
    this.loadToken();
  }

  private loadToken(): void {
    try {
      if (fs.existsSync(TOKEN_PATH)) {
        const token = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf-8'));
        this.auth.setCredentials(token);
      }
    } catch (err) {
      logger.error('Failed to load sheets token', { error: err });
    }
  }

  saveToken(token: object): void {
    const dir = path.dirname(TOKEN_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(token, null, 2));
    this.auth.setCredentials(token as Parameters<OAuth2Client['setCredentials']>[0]);
  }

  getAuthUrl(): string {
    return this.auth.generateAuthUrl({ access_type: 'offline', scope: SCOPES, prompt: 'consent' });
  }

  async exchangeCode(code: string): Promise<void> {
    const { tokens } = await this.auth.getToken(code);
    this.saveToken(tokens);
  }

  isAuthenticated(): boolean {
    const creds = this.auth.credentials;
    return !!(creds && (creds.access_token || creds.refresh_token));
  }

  async ensureSheetExists(): Promise<void> {
    try {
      const meta = await this.sheets.spreadsheets.get({ spreadsheetId: this.spreadsheetId });
      const exists = meta.data.sheets?.some((s) => s.properties?.title === this.sheetName);
      if (!exists) {
        await this.sheets.spreadsheets.batchUpdate({
          spreadsheetId: this.spreadsheetId,
          requestBody: {
            requests: [{ addSheet: { properties: { title: this.sheetName } } }],
          },
        });
        await this.addHeaders();
      }
    } catch (err) {
      logger.error('Failed to ensure sheet exists', { error: err });
      throw err;
    }
  }

  private async addHeaders(): Promise<void> {
    await this.sheets.spreadsheets.values.update({
      spreadsheetId: this.spreadsheetId,
      range: `${this.sheetName}!A1:R1`,
      valueInputOption: 'RAW',
      requestBody: { values: [SHEET_HEADERS] },
    });
  }

  async getExistingPostUrls(): Promise<Set<string>> {
    try {
      const res = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: `${this.sheetName}!H:H`,
      });
      const urls = new Set<string>();
      (res.data.values || []).slice(1).forEach((row) => {
        if (row[0]) urls.add(row[0]);
      });
      return urls;
    } catch {
      return new Set();
    }
  }

  async appendOpportunity(op: Opportunity): Promise<number> {
    const row = [
      op.id, op.date, op.company, op.recruiterName, op.recruiterProfileUrl,
      op.email, op.jobTitle, op.postUrl, op.postDate, op.postContent.slice(0, 500),
      op.relevanceScore.toString(), op.relevanceReason, op.status,
      op.generatedSubject, op.generatedEmail,
      op.sentDate, op.messageId, op.notes,
    ];

    const res = await this.sheets.spreadsheets.values.append({
      spreadsheetId: this.spreadsheetId,
      range: `${this.sheetName}!A:R`,
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [row] },
    });

    const updatedRange = res.data.updates?.updatedRange || '';
    const rowMatch = updatedRange.match(/!A(\d+)/);
    return rowMatch ? parseInt(rowMatch[1]) : -1;
  }

  async updateRow(rowIndex: number, op: Partial<Opportunity>): Promise<void> {
    const updates: Array<{ range: string; values: string[][] }> = [];

    const colMap: Record<string, number> = {
      status: 13,
      generatedSubject: 14,
      generatedEmail: 15,
      sentDate: 16,
      messageId: 17,
      notes: 18,
      relevanceScore: 11,
      relevanceReason: 12,
    };

    for (const [key, colIndex] of Object.entries(colMap)) {
      if (key in op) {
        const col = String.fromCharCode(64 + colIndex);
        updates.push({
          range: `${this.sheetName}!${col}${rowIndex}`,
          values: [[(op as Record<string, unknown>)[key]?.toString() || '']],
        });
      }
    }

    if (updates.length > 0) {
      await this.sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: this.spreadsheetId,
        requestBody: {
          valueInputOption: 'RAW',
          data: updates,
        },
      });
    }
  }

  async getAllOpportunities(): Promise<Opportunity[]> {
    try {
      const res = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: `${this.sheetName}!A:R`,
      });

      const rows = res.data.values || [];
      if (rows.length < 2) return [];

      return rows.slice(1).map((row, idx) => ({
        id: row[0] || '',
        date: row[1] || '',
        company: row[2] || '',
        recruiterName: row[3] || '',
        recruiterProfileUrl: row[4] || '',
        email: row[5] || '',
        jobTitle: row[6] || '',
        postUrl: row[7] || '',
        postDate: row[8] || '',
        postContent: row[9] || '',
        relevanceScore: parseFloat(row[10] || '0'),
        relevanceReason: row[11] || '',
        status: (row[12] || 'pending') as Opportunity['status'],
        generatedSubject: row[13] || '',
        generatedEmail: row[14] || '',
        sentDate: row[15] || '',
        messageId: row[16] || '',
        notes: row[17] || '',
        rowIndex: idx + 2,
      }));
    } catch (err) {
      logger.error('Failed to get opportunities', { error: err });
      return [];
    }
  }

  getAuth(): OAuth2Client {
    return this.auth;
  }
}
