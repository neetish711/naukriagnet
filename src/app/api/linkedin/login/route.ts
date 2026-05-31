import { NextResponse } from 'next/server';
import { sessionExists } from '@/lib/linkedin/session';

export async function GET() {
  return NextResponse.json({ sessionExists: sessionExists() });
}

export async function DELETE() {
  const { clearSession } = await import('@/lib/linkedin/session');
  clearSession();
  return NextResponse.json({ success: true });
}
