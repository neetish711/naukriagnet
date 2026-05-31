import { NextRequest, NextResponse } from 'next/server';
import { loadConfig, saveConfig, loadProfile, saveProfile } from '@/config';
import type { AppConfig, Profile } from '@/types';

export async function GET() {
  return NextResponse.json({
    config: loadConfig(),
    profile: loadProfile(),
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json() as { config?: AppConfig; profile?: Profile };
  if (body.config) saveConfig(body.config);
  if (body.profile) saveProfile(body.profile);
  return NextResponse.json({ success: true });
}
