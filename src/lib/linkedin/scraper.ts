import { chromium, Browser, BrowserContext, Page, BrowserContextOptions } from 'playwright';
import { loadSession, saveSession, sessionExists } from './session';
import { extractBestEmail } from '@/lib/email/extractor';
import { loadConfig } from '@/config';
import { logger } from '@/lib/logger';
import type { Opportunity } from '@/types';
import { randomUUID } from 'crypto';

const LINKEDIN_BASE = 'https://www.linkedin.com';

export class LinkedInScraper {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;

  async initialize(headless = true): Promise<void> {
    this.browser = await chromium.launch({
      headless,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-infobars',
      ],
    });

    const contextOptions: BrowserContextOptions = {
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 800 },
      locale: 'en-US',
    };

    if (sessionExists()) {
      const session = loadSession();
      if (session) {
        contextOptions.storageState = session as BrowserContextOptions['storageState'];
      }
    }

    this.context = await this.browser.newContext(contextOptions);
    this.page = await this.context.newPage();

    await this.page.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
    });
  }

  async login(): Promise<boolean> {
    if (!this.page) throw new Error('Scraper not initialized');

    logger.info('Navigating to LinkedIn login page');
    await this.page.goto(`${LINKEDIN_BASE}/login`, { waitUntil: 'domcontentloaded' });

    logger.info('Please log in to LinkedIn in the browser window...');

    try {
      await this.page.waitForURL('**/feed/**', { timeout: 120000 });
      const storageState = await this.context!.storageState();
      saveSession(storageState);
      logger.info('LinkedIn login successful, session saved');
      return true;
    } catch {
      logger.error('Login timeout or failed');
      return false;
    }
  }

  async isLoggedIn(): Promise<boolean> {
    if (!this.page) return false;
    try {
      await this.page.goto(`${LINKEDIN_BASE}/feed/`, { waitUntil: 'domcontentloaded', timeout: 15000 });
      const url = this.page.url();
      return url.includes('/feed/') || url.includes('/mynetwork/');
    } catch {
      return false;
    }
  }

  async searchPosts(keyword: string): Promise<Opportunity[]> {
    if (!this.page) throw new Error('Scraper not initialized');
    const config = loadConfig();
    const opportunities: Opportunity[] = [];

    const searchUrl = `${LINKEDIN_BASE}/search/results/content/?keywords=${encodeURIComponent(keyword)}&sortBy=date_posted`;
    logger.info(`Searching LinkedIn posts for: "${keyword}"`);

    try {
      await this.page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await this.delay(2000);

      const scrollCount = Math.ceil(config.linkedin.maxPostsPerKeyword / 5);
      for (let i = 0; i < scrollCount; i++) {
        await this.page.evaluate(() => window.scrollBy(0, 800));
        await this.delay(config.linkedin.delayBetweenScrollsMs);
      }

      const posts = await this.page.evaluate(() => {
        const results: Array<{
          content: string;
          postUrl: string;
          authorName: string;
          authorProfileUrl: string;
          postDate: string;
        }> = [];

        const postElements = document.querySelectorAll('.search-results__list .reusable-search__result-container, [data-chameleon-result-urn], .search-result__wrapper');

        postElements.forEach((el) => {
          try {
            const contentEl = el.querySelector('.feed-shared-update-v2__description, .update-components-text, .search-result__excerpt');
            const content = contentEl?.textContent?.trim() || '';

            const linkEl = el.querySelector('a[href*="/posts/"], a[href*="activity"]') as HTMLAnchorElement | null;
            const postUrl = linkEl?.href || '';

            const authorEl = el.querySelector('.actor-name, .update-components-actor__name span[aria-hidden="true"], .app-aware-link span[aria-hidden="true"]');
            const authorName = authorEl?.textContent?.trim() || '';

            const authorLinkEl = el.querySelector('.update-components-actor__meta a, .app-aware-link') as HTMLAnchorElement | null;
            const authorProfileUrl = authorLinkEl?.href || '';

            const dateEl = el.querySelector('time, .update-components-actor__sub-description');
            const postDate = dateEl?.getAttribute('datetime') || dateEl?.textContent?.trim() || '';

            if (content.length > 20) {
              results.push({ content, postUrl, authorName, authorProfileUrl, postDate });
            }
          } catch {
            // Skip malformed elements
          }
        });

        return results;
      });

      logger.info(`Found ${posts.length} posts for keyword: "${keyword}"`);

      for (const post of posts.slice(0, config.linkedin.maxPostsPerKeyword)) {
        const email = extractBestEmail(post.content);
        const opportunity: Opportunity = {
          id: randomUUID(),
          date: new Date().toISOString(),
          company: this.extractCompanyFromContent(post.content, post.authorProfileUrl),
          recruiterName: post.authorName,
          recruiterProfileUrl: post.authorProfileUrl,
          email,
          jobTitle: this.extractJobTitle(post.content),
          postContent: post.content,
          postUrl: post.postUrl,
          postDate: post.postDate,
          relevanceScore: 0,
          relevanceReason: '',
          status: 'pending',
          generatedSubject: '',
          generatedEmail: '',
          sentDate: '',
          messageId: '',
          notes: `Keyword: ${keyword}`,
        };
        opportunities.push(opportunity);
      }
    } catch (err) {
      logger.error(`Error searching for keyword "${keyword}"`, { error: err });
    }

    return opportunities;
  }

  private extractJobTitle(content: string): string {
    const patterns = [
      /hiring\s+(?:a\s+|an\s+)?([A-Z][a-zA-Z\s]+(?:Manager|Lead|Owner|Director|Head)[a-zA-Z\s]*)/,
      /looking\s+for\s+(?:a\s+|an\s+)?([A-Z][a-zA-Z\s]+(?:Manager|Lead|Owner|Director|Head)[a-zA-Z\s]*)/,
      /opening\s+for\s+(?:a\s+|an\s+)?([A-Z][a-zA-Z\s]+(?:Manager|Lead|Owner|Director|Head)[a-zA-Z\s]*)/,
      /role[:\s]+([A-Z][a-zA-Z\s]+(?:Manager|Lead|Owner|Director|Head)[a-zA-Z\s]*)/,
      /position[:\s]+([A-Z][a-zA-Z\s]+(?:Manager|Lead|Owner|Director|Head)[a-zA-Z\s]*)/,
    ];

    for (const pattern of patterns) {
      const match = content.match(pattern);
      if (match) return match[1].trim().slice(0, 80);
    }

    if (/AI\s+Product\s+Manager/i.test(content)) return 'AI Product Manager';
    if (/Product\s+Manager/i.test(content)) return 'Product Manager';
    if (/Product\s+Owner/i.test(content)) return 'Product Owner';
    if (/Product\s+Lead/i.test(content)) return 'Product Lead';
    return 'Product Role';
  }

  private extractCompanyFromContent(content: string, profileUrl: string): string {
    const patterns = [
      /at\s+([A-Z][a-zA-Z\s&.,]+?)(?:\s+is|\s+we|\s+our|\s+has|\.|,)/,
      /join\s+(?:us\s+at\s+)?([A-Z][a-zA-Z\s&.,]+?)(?:\s+as|\s+to|\.|,)/,
      /([A-Z][a-zA-Z\s&.,]+?)\s+is\s+(?:hiring|looking)/,
    ];

    for (const pattern of patterns) {
      const match = content.match(pattern);
      if (match && match[1].length < 60) return match[1].trim();
    }

    const companyMatch = profileUrl.match(/linkedin\.com\/company\/([^/]+)/);
    if (companyMatch) {
      return companyMatch[1].replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    }

    return 'Unknown Company';
  }

  async runFullScrape(): Promise<Opportunity[]> {
    const config = loadConfig();
    const allOpportunities: Opportunity[] = [];
    const seen = new Set<string>();

    for (const keyword of config.linkedin.searchKeywords) {
      const ops = await this.searchPosts(keyword);
      for (const op of ops) {
        const key = op.postUrl || op.id;
        if (!seen.has(key)) {
          seen.add(key);
          allOpportunities.push(op);
        }
      }
      await this.delay(config.linkedin.delayBetweenSearchesMs);
    }

    logger.info(`Total unique opportunities found: ${allOpportunities.length}`);
    return allOpportunities;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async close(): Promise<void> {
    if (this.context) {
      const storageState = await this.context.storageState();
      saveSession(storageState);
    }
    await this.browser?.close();
    logger.info('LinkedIn scraper closed');
  }
}
