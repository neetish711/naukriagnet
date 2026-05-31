import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import Link from 'next/link';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'NaukriAgent - AI Job Application Automation',
  description: 'Automated job application system for AI Product Managers',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <nav className="bg-slate-900 text-white px-6 py-3 flex items-center gap-6">
          <span className="font-bold text-lg text-blue-400">NaukriAgent</span>
          <Link href="/" className="text-sm hover:text-blue-300 transition-colors">Dashboard</Link>
          <Link href="/settings" className="text-sm hover:text-blue-300 transition-colors">Settings</Link>
          <Link href="/api/gmail/auth" className="text-sm hover:text-blue-300 transition-colors">Connect Gmail</Link>
        </nav>
        <main className="min-h-screen">{children}</main>
      </body>
    </html>
  );
}
