export interface ExtractedEmail {
  email: string;
  context: string;
}

const EMAIL_REGEX = /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g;

const HIRING_PATTERNS = [
  /send\s+(?:your\s+)?(?:resume|cv|profile)\s+to\s+([A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,})/gi,
  /email\s+(?:your\s+)?(?:resume|cv|profile|application)\s+to\s+([A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,})/gi,
  /apply\s+(?:via|through|by)\s+email(?:\s+to)?\s+([A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,})/gi,
  /(?:recruitment|hr|hiring)\s+email[:\s]+([A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,})/gi,
  /contact\s+(?:us|me)\s+at\s+([A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,})/gi,
  /reach\s+(?:out|us|me)\s+at\s+([A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,})/gi,
  /DM\s+or\s+email\s+([A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,})/gi,
  /(?:share|drop)\s+your\s+(?:resume|cv)\s+(?:at|to)\s+([A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,})/gi,
];

const BLACKLISTED_DOMAINS = [
  'example.com', 'test.com', 'placeholder.com', 'domain.com',
  'email.com', 'yourcompany.com', 'company.com'
];

export function extractEmails(text: string): ExtractedEmail[] {
  const results: ExtractedEmail[] = [];
  const seen = new Set<string>();

  // Pattern-based extraction with context
  for (const pattern of HIRING_PATTERNS) {
    let match;
    pattern.lastIndex = 0;
    while ((match = pattern.exec(text)) !== null) {
      const email = match[1].toLowerCase();
      if (isValidEmail(email) && !seen.has(email)) {
        seen.add(email);
        const contextStart = Math.max(0, match.index - 50);
        const contextEnd = Math.min(text.length, match.index + match[0].length + 50);
        results.push({ email, context: text.slice(contextStart, contextEnd).trim() });
      }
    }
  }

  // Generic email extraction
  const allEmails = text.match(EMAIL_REGEX) || [];
  for (const email of allEmails) {
    const lower = email.toLowerCase();
    if (isValidEmail(lower) && !seen.has(lower)) {
      seen.add(lower);
      const idx = text.toLowerCase().indexOf(lower);
      const contextStart = Math.max(0, idx - 50);
      const contextEnd = Math.min(text.length, idx + lower.length + 50);
      results.push({ email: lower, context: text.slice(contextStart, contextEnd).trim() });
    }
  }

  return results;
}

export function isValidEmail(email: string): boolean {
  if (!email || email.length > 254) return false;
  const emailRegex = /^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$/;
  if (!emailRegex.test(email)) return false;
  const domain = email.split('@')[1].toLowerCase();
  if (BLACKLISTED_DOMAINS.includes(domain)) return false;
  // No image extensions
  if (/\.(png|jpg|jpeg|gif|svg|ico)$/.test(domain)) return false;
  return true;
}

export function extractBestEmail(text: string): string {
  const emails = extractEmails(text);
  if (emails.length === 0) return '';
  // Prefer pattern-matched emails (first ones found)
  return emails[0].email;
}
