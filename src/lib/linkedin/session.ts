import fs from 'fs';
import path from 'path';
import { logger } from '@/lib/logger';

const SESSION_DIR = path.join(process.cwd(), 'data', 'sessions');
const SESSION_FILE = path.join(SESSION_DIR, 'linkedin-session.json');

export function ensureSessionDir(): void {
  if (!fs.existsSync(SESSION_DIR)) {
    fs.mkdirSync(SESSION_DIR, { recursive: true });
  }
}

export function sessionExists(): boolean {
  return fs.existsSync(SESSION_FILE);
}

export function loadSession(): object | null {
  try {
    if (!sessionExists()) return null;
    const raw = fs.readFileSync(SESSION_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    logger.error('Failed to load LinkedIn session', { error: err });
    return null;
  }
}

export function saveSession(storageState: object): void {
  ensureSessionDir();
  fs.writeFileSync(SESSION_FILE, JSON.stringify(storageState, null, 2), 'utf-8');
  logger.info('LinkedIn session saved');
}

export function clearSession(): void {
  if (fs.existsSync(SESSION_FILE)) {
    fs.unlinkSync(SESSION_FILE);
    logger.info('LinkedIn session cleared');
  }
}
