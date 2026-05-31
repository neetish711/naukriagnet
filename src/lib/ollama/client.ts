import axios from 'axios';
import { loadConfig } from '@/config';
import { logger } from '@/lib/logger';
import type { Opportunity, Profile } from '@/types';

interface OllamaResponse {
  model: string;
  created_at: string;
  response: string;
  done: boolean;
}

export class OllamaClient {
  private baseUrl: string;
  private model: string;
  private temperature: number;
  private timeout: number;

  constructor() {
    const config = loadConfig();
    this.baseUrl = process.env.OLLAMA_BASE_URL || config.ollama.baseUrl;
    this.model = process.env.OLLAMA_MODEL || config.ollama.model;
    this.temperature = config.ollama.temperature;
    this.timeout = config.ollama.timeout;
  }

  async generate(prompt: string): Promise<string> {
    try {
      const response = await axios.post<OllamaResponse>(
        `${this.baseUrl}/api/generate`,
        {
          model: this.model,
          prompt,
          stream: false,
          options: { temperature: this.temperature },
        },
        { timeout: this.timeout }
      );
      return response.data.response.trim();
    } catch (err) {
      logger.error('Ollama generation failed', { error: err });
      throw new Error(`Ollama generation failed: ${err}`);
    }
  }

  async checkHealth(): Promise<boolean> {
    try {
      await axios.get(`${this.baseUrl}/api/tags`, { timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }

  async assessRelevance(opportunity: Opportunity): Promise<{ score: number; reason: string }> {
    const prompt = `You are a job relevance assessor. Analyze if this LinkedIn post is relevant for an AI Product Manager job seeker.

POST CONTENT:
${opportunity.postContent.slice(0, 800)}

JOB TITLE EXTRACTED: ${opportunity.jobTitle}

Relevant roles: AI Product Manager, Product Manager, Senior Product Manager, Lead Product Manager, Product Owner, Director of Product, Head of Product, VP of Product.

NOT relevant: Engineering roles, Sales roles, Marketing roles, Finance roles, HR roles (unless it's specifically hiring for PM roles).

Respond in JSON format only (no markdown, no explanation):
{"score": 0.0, "reason": "brief reason under 20 words", "isRelevant": true/false}

Score: 0.0 to 1.0 where 1.0 is perfectly relevant.`;

    try {
      const response = await this.generate(prompt);
      const jsonMatch = response.match(/\{[^}]+\}/);
      if (!jsonMatch) return { score: 0.5, reason: 'Could not assess' };
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        score: Math.min(1, Math.max(0, parsed.score || 0.5)),
        reason: parsed.reason || '',
      };
    } catch {
      return { score: 0.5, reason: 'Assessment failed' };
    }
  }

  async generateEmail(opportunity: Opportunity, profile: Profile): Promise<{ subject: string; body: string }> {
    const config = loadConfig();
    const experienceStr = profile.experience
      .slice(0, 2)
      .map((e) => `${e.title} at ${e.company}`)
      .join(', ');

    const prompt = `You are a professional email writer. Write a SHORT, PERSONALIZED job application email.

RECRUITER NAME: ${opportunity.recruiterName || 'Hiring Manager'}
COMPANY: ${opportunity.company}
JOB TITLE: ${opportunity.jobTitle}
POST EXCERPT: ${opportunity.postContent.slice(0, 300)}

APPLICANT PROFILE:
- Name: ${profile.name}
- Title: ${profile.title}
- Experience: ${experienceStr}
- Key Skills: ${profile.skills.slice(0, 5).join(', ')}
- Achievement: ${profile.achievements[0] || 'delivered impactful AI products'}

REQUIREMENTS:
- Under 150 words
- Mention recruiter name
- Mention company name
- Reference their hiring post
- Mention AI Product Management background
- Mention resume is attached
- Professional but warm tone
- Human sounding (NOT generic AI text)
- No buzzwords like "leverage", "synergy", "paradigm"
- End with a specific ask for a call

Respond in JSON format only:
{"subject": "email subject line", "body": "email body text"}`;

    try {
      const response = await this.generate(prompt);
      const jsonMatch = response.match(/\{[\s\S]*"subject"[\s\S]*"body"[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON in response');
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        subject: parsed.subject || `Application for ${opportunity.jobTitle} - ${profile.name}`,
        body: parsed.body || '',
      };
    } catch (err) {
      logger.error('Email generation failed', { error: err });
      const recruiterFirst = opportunity.recruiterName.split(' ')[0] || 'there';
      return {
        subject: config.email.subjectTemplate
          .replace('{jobTitle}', opportunity.jobTitle)
          .replace('{name}', profile.name),
        body: `Hi ${recruiterFirst},\n\nI came across your post about the ${opportunity.jobTitle} role at ${opportunity.company} and I'm very interested.\n\nI'm an AI Product Manager with experience in ${profile.skills.slice(0, 3).join(', ')}. ${profile.achievements[0] || 'I have a strong track record of delivering AI-powered products.'}.\n\nI've attached my resume and would love to connect for a quick call.\n\nBest regards,\n${profile.name}`,
      };
    }
  }
}
