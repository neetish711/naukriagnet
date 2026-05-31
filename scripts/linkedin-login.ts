import { chromium } from 'playwright';
import { saveSession, ensureSessionDir } from '../src/lib/linkedin/session';

async function main() {
  ensureSessionDir();
  console.log('\nLinkedIn Login Tool');
  console.log('======================');
  console.log('A browser window will open. Please log in to LinkedIn manually.');
  console.log('The session will be saved for future use.\n');

  const browser = await chromium.launch({
    headless: false,
    args: ['--disable-blink-features=AutomationControlled'],
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 },
  });

  const page = await context.newPage();
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  });

  await page.goto('https://www.linkedin.com/login');
  console.log('Browser opened. Please log in to LinkedIn...');

  try {
    await page.waitForURL('**/feed/**', { timeout: 120000 });
    console.log('Login detected! Saving session...');
    const storageState = await context.storageState();
    saveSession(storageState);
    console.log('Session saved to data/sessions/linkedin-session.json');
    console.log('\nYou can now run: npm run scrape\n');
  } catch {
    console.error('Login timeout. Please try again.');
  }

  await browser.close();
  process.exit(0);
}

main().catch(console.error);
