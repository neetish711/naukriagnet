import { NextResponse } from 'next/server';
import { LinkedInScraper } from '@/lib/linkedin/scraper';
import { OllamaClient } from '@/lib/ollama/client';
import { SheetsClient } from '@/lib/sheets/client';
import { loadConfig, loadProfile } from '@/config';
import { logger } from '@/lib/logger';
import type { Opportunity } from '@/types';

export async function POST() {
  const scraper = new LinkedInScraper();
  try {
    const config = loadConfig();
    const ollamaClient = new OllamaClient();
    const sheetsClient = new SheetsClient();

    const ollamaOk = await ollamaClient.checkHealth();
    if (!ollamaOk) {
      return NextResponse.json({ success: false, error: 'Ollama is not running. Start with: ollama serve' }, { status: 503 });
    }

    await scraper.initialize(true);

    const isLoggedIn = await scraper.isLoggedIn();
    if (!isLoggedIn) {
      await scraper.close();
      return NextResponse.json({ success: false, error: 'LinkedIn session expired. Run: npm run login' }, { status: 401 });
    }

    const opportunities = await scraper.runFullScrape();
    const existingUrls = await sheetsClient.getExistingPostUrls();
    const profile = loadProfile();

    let relevant = 0;
    let duplicates = 0;
    const stored: Opportunity[] = [];

    for (const op of opportunities) {
      if (op.postUrl && existingUrls.has(op.postUrl)) {
        duplicates++;
        continue;
      }

      const { score, reason } = await ollamaClient.assessRelevance(op);
      op.relevanceScore = score;
      op.relevanceReason = reason;

      if (score < config.relevanceScoreThreshold) continue;

      relevant++;

      if (op.email) {
        try {
          const { subject, body } = await ollamaClient.generateEmail(op, profile);
          op.generatedSubject = subject;
          op.generatedEmail = body;
        } catch {
          logger.warn('Email generation failed for opportunity', { id: op.id });
        }
      }

      const rowIndex = await sheetsClient.appendOpportunity(op);
      op.rowIndex = rowIndex;
      stored.push(op);

      await new Promise((r) => setTimeout(r, 500));
    }

    logger.info('Scrape complete', { total: opportunities.length, relevant, duplicates });

    return NextResponse.json({
      success: true,
      total: opportunities.length,
      relevant,
      duplicates,
      stored: stored.length,
    });
  } catch (err) {
    logger.error('Scrape failed', { error: err });
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  } finally {
    await scraper.close();
  }
}
