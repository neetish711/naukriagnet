import cron from 'node-cron';
import { loadConfig } from '@/config';
import { logger } from '@/lib/logger';

type ScheduledTask = ReturnType<typeof cron.schedule>;
const activeTasks: Map<string, ScheduledTask> = new Map();

export function setupScheduler(
  onScrape: () => Promise<void>,
  onSend: () => Promise<void>
): void {
  const config = loadConfig();

  if (!config.scheduler.enabled) {
    logger.info('Scheduler disabled in config');
    return;
  }

  activeTasks.forEach((task) => task.stop());
  activeTasks.clear();

  if (config.scheduler.scrapeSchedule) {
    const scrapeTask = cron.schedule(
      config.scheduler.scrapeSchedule,
      async () => {
        logger.info('Scheduled scrape started');
        try {
          await onScrape();
        } catch (err) {
          logger.error('Scheduled scrape failed', { error: err });
        }
      },
      { timezone: config.scheduler.timezone }
    );
    activeTasks.set('scrape', scrapeTask);
    logger.info(`Scrape scheduled: ${config.scheduler.scrapeSchedule}`);
  }

  if (config.scheduler.sendSchedule) {
    const sendTask = cron.schedule(
      config.scheduler.sendSchedule,
      async () => {
        logger.info('Scheduled send started');
        try {
          await onSend();
        } catch (err) {
          logger.error('Scheduled send failed', { error: err });
        }
      },
      { timezone: config.scheduler.timezone }
    );
    activeTasks.set('send', sendTask);
    logger.info(`Send scheduled: ${config.scheduler.sendSchedule}`);
  }
}

export function stopScheduler(): void {
  activeTasks.forEach((task) => task.stop());
  activeTasks.clear();
  logger.info('Scheduler stopped');
}
