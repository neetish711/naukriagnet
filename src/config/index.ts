import fs from 'fs';
import path from 'path';
import type { AppConfig, Profile } from '@/types';

const CONFIG_PATH = path.join(process.cwd(), 'config.json');
const PROFILE_PATH = path.join(process.cwd(), 'profile.json');

export function loadConfig(): AppConfig {
  const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
  return JSON.parse(raw) as AppConfig;
}

export function saveConfig(config: AppConfig): void {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
}

export function loadProfile(): Profile {
  const raw = fs.readFileSync(PROFILE_PATH, 'utf-8');
  return JSON.parse(raw) as Profile;
}

export function saveProfile(profile: Profile): void {
  fs.writeFileSync(PROFILE_PATH, JSON.stringify(profile, null, 2), 'utf-8');
}

export function getEnv(key: string, fallback?: string): string {
  const val = process.env[key] ?? fallback;
  if (!val) throw new Error(`Missing required environment variable: ${key}`);
  return val;
}
