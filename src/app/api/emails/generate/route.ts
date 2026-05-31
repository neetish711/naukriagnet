import { NextRequest, NextResponse } from 'next/server';
import { OllamaClient } from '@/lib/ollama/client';
import { SheetsClient } from '@/lib/sheets/client';
import { loadProfile } from '@/config';
import { logger } from '@/lib/logger';

const sheetsClient = new SheetsClient();
const ollamaClient = new OllamaClient();

export async function POST(req: NextRequest) {
  try {
    const { ids } = await req.json() as { ids: string[] };
    const profile = loadProfile();
    const all = await sheetsClient.getAllOpportunities();
    let count = 0;

    for (const id of ids) {
      const op = all.find((o) => o.id === id);
      if (!op || !op.rowIndex) continue;

      const { subject, body } = await ollamaClient.generateEmail(op, profile);
      await sheetsClient.updateRow(op.rowIndex, { generatedSubject: subject, generatedEmail: body });
      count++;
    }

    return NextResponse.json({ success: true, count });
  } catch (err) {
    logger.error('Email generation failed', { error: err });
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}
