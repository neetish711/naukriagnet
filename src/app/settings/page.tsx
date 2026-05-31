'use client';

import { useState, useEffect } from 'react';
import type { AppConfig, Profile } from '@/types';

export default function SettingsPage() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [activeTab, setActiveTab] = useState<'general' | 'profile' | 'linkedin' | 'email' | 'ollama'>('general');

  useEffect(() => {
    fetch('/api/settings').then((r) => r.json()).then((data) => {
      setConfig(data.config);
      setProfile(data.profile);
    });
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config, profile }),
      });
      setMessage({ type: 'success', text: 'Settings saved successfully' });
    } catch {
      setMessage({ type: 'error', text: 'Failed to save settings' });
    } finally {
      setSaving(false);
      setTimeout(() => setMessage(null), 4000);
    }
  };

  if (!config || !profile) return <div className="p-6 text-slate-400">Loading settings...</div>;

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold text-slate-900 mb-6">Settings</h1>

      {message && (
        <div className={`mb-4 p-3 rounded-lg text-sm ${message.type === 'success' ? 'bg-green-50 text-green-800 border border-green-200' : 'bg-red-50 text-red-800 border border-red-200'}`}>
          {message.text}
        </div>
      )}

      <div className="flex gap-1 mb-6 bg-slate-100 p-1 rounded-lg w-fit">
        {(['general', 'profile', 'linkedin', 'email', 'ollama'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm rounded-md transition-colors capitalize ${activeTab === tab ? 'bg-white text-slate-900 shadow-sm font-medium' : 'text-slate-600 hover:text-slate-900'}`}
          >
            {tab}
          </button>
        ))}
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-6">
        {activeTab === 'general' && (
          <div className="space-y-6">
            <h2 className="font-semibold text-slate-900">General Settings</h2>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Relevance Score Threshold</label>
              <input
                type="number"
                min="0"
                max="1"
                step="0.05"
                value={config.relevanceScoreThreshold}
                onChange={(e) => setConfig({ ...config, relevanceScoreThreshold: parseFloat(e.target.value) })}
                className="w-32 px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
              />
              <p className="text-xs text-slate-400 mt-1">Minimum score (0-1) for an opportunity to be stored</p>
            </div>
            <div>
              <label className="flex items-center gap-2 text-sm font-medium text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={config.scheduler.enabled}
                  onChange={(e) => setConfig({ ...config, scheduler: { ...config.scheduler, enabled: e.target.checked } })}
                  className="rounded"
                />
                Enable Scheduler
              </label>
            </div>
            {config.scheduler.enabled && (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Scrape Schedule (cron)</label>
                  <input
                    type="text"
                    value={config.scheduler.scrapeSchedule}
                    onChange={(e) => setConfig({ ...config, scheduler: { ...config.scheduler, scrapeSchedule: e.target.value } })}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Send Schedule (cron)</label>
                  <input
                    type="text"
                    value={config.scheduler.sendSchedule}
                    onChange={(e) => setConfig({ ...config, scheduler: { ...config.scheduler, sendSchedule: e.target.value } })}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'profile' && (
          <div className="space-y-4">
            <h2 className="font-semibold text-slate-900">Your Profile</h2>
            {(['name', 'title', 'email', 'phone', 'location', 'linkedinUrl', 'githubUrl', 'portfolioUrl', 'resumePath'] as const).map((field) => (
              <div key={field}>
                <label className="block text-sm font-medium text-slate-700 mb-1 capitalize">{field.replace(/([A-Z])/g, ' $1')}</label>
                <input
                  type="text"
                  value={profile[field] as string || ''}
                  onChange={(e) => setProfile({ ...profile, [field]: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>
            ))}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Summary</label>
              <textarea
                rows={4}
                value={profile.summary}
                onChange={(e) => setProfile({ ...profile, summary: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Skills (comma separated)</label>
              <input
                type="text"
                value={profile.skills.join(', ')}
                onChange={(e) => setProfile({ ...profile, skills: e.target.value.split(',').map((s) => s.trim()) })}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>
          </div>
        )}

        {activeTab === 'linkedin' && (
          <div className="space-y-4">
            <h2 className="font-semibold text-slate-900">LinkedIn Settings</h2>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Search Keywords (one per line)</label>
              <textarea
                rows={8}
                value={config.linkedin.searchKeywords.join('\n')}
                onChange={(e) => setConfig({ ...config, linkedin: { ...config.linkedin, searchKeywords: e.target.value.split('\n').filter(Boolean) } })}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none font-mono"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Max Posts Per Keyword</label>
                <input
                  type="number"
                  value={config.linkedin.maxPostsPerKeyword}
                  onChange={(e) => setConfig({ ...config, linkedin: { ...config.linkedin, maxPostsPerKeyword: parseInt(e.target.value) } })}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Delay Between Searches (ms)</label>
                <input
                  type="number"
                  value={config.linkedin.delayBetweenSearchesMs}
                  onChange={(e) => setConfig({ ...config, linkedin: { ...config.linkedin, delayBetweenSearchesMs: parseInt(e.target.value) } })}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>
            </div>
          </div>
        )}

        {activeTab === 'email' && (
          <div className="space-y-4">
            <h2 className="font-semibold text-slate-900">Email Settings</h2>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Daily Send Limit</label>
              <input
                type="number"
                value={config.email.dailySendLimit}
                onChange={(e) => setConfig({ ...config, email: { ...config.email, dailySendLimit: parseInt(e.target.value) } })}
                className="w-32 px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Subject Template</label>
              <input
                type="text"
                value={config.email.subjectTemplate}
                onChange={(e) => setConfig({ ...config, email: { ...config.email, subjectTemplate: e.target.value } })}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
              />
              <p className="text-xs text-slate-400 mt-1">Variables: {'{jobTitle}'}, {'{name}'}</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Delay Between Emails (ms)</label>
              <input
                type="number"
                value={config.email.delayBetweenEmailsMs}
                onChange={(e) => setConfig({ ...config, email: { ...config.email, delayBetweenEmailsMs: parseInt(e.target.value) } })}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>
          </div>
        )}

        {activeTab === 'ollama' && (
          <div className="space-y-4">
            <h2 className="font-semibold text-slate-900">Ollama AI Settings</h2>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Model</label>
              <input
                type="text"
                value={config.ollama.model}
                onChange={(e) => setConfig({ ...config, ollama: { ...config.ollama, model: e.target.value } })}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                placeholder="qwen3:14b"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Base URL</label>
              <input
                type="text"
                value={config.ollama.baseUrl}
                onChange={(e) => setConfig({ ...config, ollama: { ...config.ollama, baseUrl: e.target.value } })}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Temperature (0-1)</label>
              <input
                type="number"
                min="0"
                max="1"
                step="0.1"
                value={config.ollama.temperature}
                onChange={(e) => setConfig({ ...config, ollama: { ...config.ollama, temperature: parseFloat(e.target.value) } })}
                className="w-32 px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>
          </div>
        )}
      </div>

      <div className="mt-4 flex justify-end">
        <button
          onClick={save}
          disabled={saving}
          className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors font-medium"
        >
          {saving ? 'Saving...' : 'Save Settings'}
        </button>
      </div>
    </div>
  );
}
