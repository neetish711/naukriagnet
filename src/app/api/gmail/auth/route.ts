import { NextResponse } from 'next/server';
import { SheetsClient } from '@/lib/sheets/client';

const sheetsClient = new SheetsClient();

export async function GET() {
  const authUrl = sheetsClient.getAuthUrl();
  return NextResponse.redirect(authUrl);
}
