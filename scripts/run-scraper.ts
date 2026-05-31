import * as dotenv from 'dotenv';
dotenv.config();

import { LinkedInScraper } from '../src/lib/linkedin/scraper';
import { OllamaClient } from '../src/lib/ollama/client';
import { SheetsClient } from '../src/lib/sheets/client';
import { loadConfig, loadProfile } from '../src/config';
import { logger } from '../src/lib/logger';

async function main() {
  console.log('\nNaukriAgent Scraper');
  console.log('======================\n');

  const config = loadConfig();
  const profile = loadProfile();
  const scraper = new LinkedInScraper();
  const ollamaClient = new OllamaClient();
  const sheetsClient = new SheetsClient();

  console.log('Checking prerequisites...');
  const ollamaOk = await ollamaClient.checkHealth();
  if (!ollamaOk) {
    console.error('Ollama is not running. Start with: ollama serve');
    process.exit(1);
  }
  console.log('Ollama is running');

  if (!sheetsClient.isAuthenticated()) {
    console.error('Google not authenticated. Visit http://localhost:3000/api/gmail/auth');
    process.exit(1);
  }
  console.log('Google Sheets authenticated');

  try {
    await scraper.initialize(true);
    const isLoggedIn = await scraper.isLoggedIn();

    if (!isLoggedIn) {
      console.error('LinkedIn session expired. Run: npm run login');
      await scraper.close();
      process.exit(1);
    }
    console.log('LinkedIn session active\n');

    console.log('Starting LinkedIn scrape...');
    const opportunities = await scraper.runFullScrape();
    console.log(`Found ${opportunities.length} posts\n`);

    const existingUrls = await sheetsClient.getExistingPostUrls();
    let relevant = 0, duplicates = 0, stored = 0;

    for (const op of opportunities) {
      if (op.postUrl && existingUrls.has(op.postUrl)) {
        duplicates++;
        continue;
      }

      process.stdout.write(`Assessing: ${op.company} - ${op.jobTitle}... `);
      const { score, reason } = await ollamaClient.assessRelevance(op);
      op.relevanceScore = score;
      op.relevanceReason = reason;

      if (score < config.relevanceScoreThreshold) {
        console.log(`(${(score * 100).toFixed(0)}% - ${reason})`);
        continue;
      }

      relevant++;
      console.log(`OK (${(score * 100).toFixed(0)}%)`);

      if (op.email) {
        const { subject, body } = await ollamaClient.generateEmail(op, profile);
        op.generatedSubject = subject;
        op.generatedEmail = body;
      }

      await sheetsClient.appendOpportunity(op);
      stored++;

      await new Promise((r) => setTimeout(r, 500));
    }

    console.log(`\nSummary:`);
    console.log(`   Total posts: ${opportunities.length}`);
    console.log(`   Duplicates: ${duplicates}`);
    console.log(`   Relevant: ${relevant}`);
    console.log(`   Stored: ${stored}`);
    console.log(`\nScrape complete! Open http://localhost:3000 to review.\n`);

  } finally {
    await scraper.close();
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
