import { NextRequest, NextResponse } from 'next/server';
import { SheetsClient } from '@/lib/sheets/client';
import { logger } from '@/lib/logger';

const sheetsClient = new SheetsClient();

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code');
  if (!code) {
    return NextResponse.json({ error: 'No code provided' }, { status: 400 });
  }

  try {
    await sheetsClient.exchangeCode(code);
    logger.info('Gmail OAuth completed');
    return NextResponse.redirect(new URL('/?auth=success', req.url));
  } catch (err) {
    logger.error('Gmail OAuth failed', { error: err });
    return NextResponse.redirect(new URL('/?auth=error', req.url));
  }
}
