import { NextRequest, NextResponse } from 'next/server';
import { SheetsClient } from '@/lib/sheets/client';
import type { DashboardStats, Opportunity } from '@/types';
import { logger } from '@/lib/logger';

const sheetsClient = new SheetsClient();

export async function GET() {
  try {
    if (!sheetsClient.isAuthenticated()) {
      return NextResponse.json({ opportunities: [], stats: null, error: 'Not authenticated with Google' });
    }
    await sheetsClient.ensureSheetExists();
    const opportunities = await sheetsClient.getAllOpportunities();

    const today = new Date().toDateString();
    const stats: DashboardStats = {
      total: opportunities.length,
      pending: opportunities.filter((o) => o.status === 'pending').length,
      approved: opportunities.filter((o) => o.status === 'approved').length,
      rejected: opportunities.filter((o) => o.status === 'rejected').length,
      sent: opportunities.filter((o) => o.status === 'sent').length,
      failed: opportunities.filter((o) => o.status === 'failed').length,
      replied: opportunities.filter((o) => o.status === 'replied').length,
      todaySent: opportunities.filter((o) => o.status === 'sent' && o.sentDate && new Date(o.sentDate).toDateString() === today).length,
    };

    return NextResponse.json({ opportunities, stats });
  } catch (err) {
    logger.error('Failed to get opportunities', { error: err });
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json() as Partial<Opportunity> & { id: string; rowIndex?: number };
    if (!body.rowIndex) {
      const all = await sheetsClient.getAllOpportunities();
      const found = all.find((o) => o.id === body.id);
      if (found?.rowIndex) body.rowIndex = found.rowIndex;
    }
    if (body.rowIndex) {
      await sheetsClient.updateRow(body.rowIndex, body);
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    logger.error('Failed to update opportunity', { error: err });
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
