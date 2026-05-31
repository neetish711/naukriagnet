import { NextRequest, NextResponse } from 'next/server';
import { loadConfig, saveConfig } from '@/config';

export async function POST(req: NextRequest) {
  const { action } = await req.json() as { action: 'enable' | 'disable' | 'run-scrape' | 'run-send' };
  const config = loadConfig();

  if (action === 'enable') {
    saveConfig({ ...config, scheduler: { ...config.scheduler, enabled: true } });
    return NextResponse.json({ success: true, message: 'Scheduler enabled' });
  }

  if (action === 'disable') {
    saveConfig({ ...config, scheduler: { ...config.scheduler, enabled: false } });
    return NextResponse.json({ success: true, message: 'Scheduler disabled' });
  }

  if (action === 'run-scrape') {
    const res = await fetch(`${process.env.APP_URL || 'http://localhost:3000'}/api/linkedin/scrape`, { method: 'POST' });
    const data = await res.json();
    return NextResponse.json(data);
  }

  if (action === 'run-send') {
    const res = await fetch(`${process.env.APP_URL || 'http://localhost:3000'}/api/emails/send`, { method: 'POST' });
    const data = await res.json();
    return NextResponse.json(data);
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
