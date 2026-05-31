export interface Opportunity {
  id: string;
  date: string;
  company: string;
  recruiterName: string;
  recruiterProfileUrl: string;
  email: string;
  jobTitle: string;
  postContent: string;
  postUrl: string;
  postDate: string;
  relevanceScore: number;
  relevanceReason: string;
  status: 'pending' | 'approved' | 'rejected' | 'sent' | 'failed' | 'replied';
  generatedSubject: string;
  generatedEmail: string;
  sentDate: string;
  messageId: string;
  notes: string;
  rowIndex?: number;
}

export interface Profile {
  name: string;
  title: string;
  email: string;
  phone: string;
  location: string;
  summary: string;
  experience: Array<{
    title: string;
    company: string;
    duration: string;
    highlights: string[];
  }>;
  skills: string[];
  education: string;
  resumePath: string;
  linkedinUrl: string;
  githubUrl: string;
  portfolioUrl: string;
  achievements: string[];
}

export interface AppConfig {
  linkedin: {
    searchKeywords: string[];
    searchType: string;
    sortBy: string;
    maxPostsPerKeyword: number;
    delayBetweenSearchesMs: number;
    delayBetweenScrollsMs: number;
  };
  email: {
    dailySendLimit: number;
    delayBetweenEmailsMs: number;
    subjectTemplate: string;
    maxEmailLength: number;
  };
  ollama: {
    model: string;
    baseUrl: string;
    temperature: number;
    timeout: number;
  };
  scheduler: {
    enabled: boolean;
    scrapeSchedule: string;
    sendSchedule: string;
    timezone: string;
  };
  relevanceScoreThreshold: number;
  sheets: {
    sheetName: string;
    logSheetName: string;
  };
}

export interface ScrapingResult {
  total: number;
  relevant: number;
  duplicates: number;
  errors: string[];
  opportunities: Opportunity[];
}

export interface EmailSendResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

export interface DashboardStats {
  total: number;
  pending: number;
  approved: number;
  rejected: number;
  sent: number;
  failed: number;
  replied: number;
  todaySent: number;
}
