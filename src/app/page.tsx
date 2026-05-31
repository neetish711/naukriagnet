'use client';

import { useState, useEffect, useCallback } from 'react';
import type { Opportunity, DashboardStats } from '@/types';

type FilterStatus = 'all' | Opportunity['status'];

export default function DashboardPage() {
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterStatus>('all');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [editSubject, setEditSubject] = useState('');
  const [scraping, setScraping] = useState(false);
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/opportunities');
      const data = await res.json();
      setOpportunities(data.opportunities || []);
      setStats(data.stats || null);
    } catch {
      showMessage('error', 'Failed to load opportunities');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const showMessage = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 5000);
  };

  const filteredOps = opportunities.filter((op) => {
    const matchesFilter = filter === 'all' || op.status === filter;
    const matchesSearch = !search ||
      op.company.toLowerCase().includes(search.toLowerCase()) ||
      op.recruiterName.toLowerCase().includes(search.toLowerCase()) ||
      op.jobTitle.toLowerCase().includes(search.toLowerCase()) ||
      op.email.toLowerCase().includes(search.toLowerCase());
    return matchesFilter && matchesSearch;
  });

  const updateStatus = async (id: string, status: Opportunity['status'], rowIndex?: number) => {
    try {
      await fetch('/api/opportunities', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status, rowIndex }),
      });
      setOpportunities((prev) => prev.map((op) => op.id === id ? { ...op, status } : op));
    } catch {
      showMessage('error', 'Failed to update status');
    }
  };

  const saveEdit = async (op: Opportunity) => {
    try {
      await fetch('/api/opportunities', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: op.id,
          rowIndex: op.rowIndex,
          generatedEmail: editContent,
          generatedSubject: editSubject,
        }),
      });
      setOpportunities((prev) => prev.map((o) =>
        o.id === op.id ? { ...o, generatedEmail: editContent, generatedSubject: editSubject } : o
      ));
      setEditingId(null);
      showMessage('success', 'Email updated');
    } catch {
      showMessage('error', 'Failed to save');
    }
  };

  const runScrape = async () => {
    setScraping(true);
    try {
      const res = await fetch('/api/linkedin/scrape', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        showMessage('success', `Found ${data.total} opportunities, ${data.relevant} relevant`);
        fetchData();
      } else {
        showMessage('error', data.error || 'Scrape failed');
      }
    } catch {
      showMessage('error', 'Scrape request failed');
    } finally {
      setScraping(false);
    }
  };

  const sendApproved = async () => {
    setSending(true);
    try {
      const res = await fetch('/api/emails/send', { method: 'POST' });
      const data = await res.json();
      showMessage('success', `Sent: ${data.sent}, Failed: ${data.failed}`);
      fetchData();
    } catch {
      showMessage('error', 'Send failed');
    } finally {
      setSending(false);
    }
  };

  const generateEmails = async (ids: string[]) => {
    try {
      const res = await fetch('/api/emails/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      });
      const data = await res.json();
      if (data.success) {
        showMessage('success', `Generated ${data.count} emails`);
        fetchData();
      }
    } catch {
      showMessage('error', 'Generation failed');
    }
  };

  const bulkApprove = async () => {
    const ids = Array.from(selected);
    for (const id of ids) {
      const op = opportunities.find((o) => o.id === id);
      if (op) await updateStatus(id, 'approved', op.rowIndex);
    }
    setSelected(new Set());
    showMessage('success', `Approved ${ids.length} items`);
  };

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const statusColor: Record<string, string> = {
    pending: 'bg-yellow-100 text-yellow-800',
    approved: 'bg-green-100 text-green-800',
    rejected: 'bg-red-100 text-red-800',
    sent: 'bg-blue-100 text-blue-800',
    failed: 'bg-red-200 text-red-900',
    replied: 'bg-purple-100 text-purple-800',
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex justify-between items-start mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Job Applications Dashboard</h1>
          <p className="text-slate-500 text-sm mt-1">AI-powered job application automation</p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={runScrape}
            disabled={scraping}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors text-sm font-medium"
          >
            {scraping ? 'Scraping...' : 'Run Scrape'}
          </button>
          <button
            onClick={sendApproved}
            disabled={sending}
            className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors text-sm font-medium"
          >
            {sending ? 'Sending...' : 'Send Approved'}
          </button>
        </div>
      </div>

      {message && (
        <div className={`mb-4 p-3 rounded-lg text-sm font-medium ${message.type === 'success' ? 'bg-green-50 text-green-800 border border-green-200' : 'bg-red-50 text-red-800 border border-red-200'}`}>
          {message.text}
        </div>
      )}

      {stats && (
        <div className="grid grid-cols-4 gap-4 mb-6 md:grid-cols-7">
          {[
            { label: 'Total', value: stats.total, color: 'bg-slate-100' },
            { label: 'Pending', value: stats.pending, color: 'bg-yellow-50' },
            { label: 'Approved', value: stats.approved, color: 'bg-green-50' },
            { label: 'Sent', value: stats.sent, color: 'bg-blue-50' },
            { label: 'Replied', value: stats.replied, color: 'bg-purple-50' },
            { label: 'Failed', value: stats.failed, color: 'bg-red-50' },
            { label: 'Today Sent', value: stats.todaySent, color: 'bg-teal-50' },
          ].map((s) => (
            <div key={s.label} className={`${s.color} p-3 rounded-lg text-center`}>
              <div className="text-2xl font-bold text-slate-900">{s.value}</div>
              <div className="text-xs text-slate-500 mt-1">{s.label}</div>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-3 mb-4 flex-wrap">
        <input
          type="text"
          placeholder="Search company, recruiter, job title..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 min-w-48 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
        />
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value as FilterStatus)}
          className="px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
        >
          <option value="all">All Status</option>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
          <option value="sent">Sent</option>
          <option value="replied">Replied</option>
          <option value="failed">Failed</option>
        </select>
        {selected.size > 0 && (
          <>
            <button
              onClick={bulkApprove}
              className="px-3 py-2 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700"
            >
              Approve ({selected.size})
            </button>
            <button
              onClick={() => generateEmails(Array.from(selected))}
              className="px-3 py-2 bg-purple-600 text-white rounded-lg text-sm hover:bg-purple-700"
            >
              Generate Emails ({selected.size})
            </button>
          </>
        )}
      </div>

      {loading ? (
        <div className="text-center py-20 text-slate-400">Loading opportunities...</div>
      ) : filteredOps.length === 0 ? (
        <div className="text-center py-20 text-slate-400">
          <p className="text-lg mb-2">No opportunities found</p>
          <p className="text-sm">Run a scrape to find new job postings</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredOps.map((op) => (
            <div key={op.id} className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm hover:shadow-md transition-shadow">
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={selected.has(op.id)}
                  onChange={() => toggleSelect(op.id)}
                  className="mt-1 h-4 w-4 rounded border-slate-300 text-blue-600"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className="font-semibold text-slate-900">{op.company}</span>
                    <span className="text-slate-400">·</span>
                    <span className="text-slate-700">{op.jobTitle}</span>
                    <span className={`ml-auto text-xs px-2 py-0.5 rounded-full font-medium ${statusColor[op.status] || 'bg-slate-100 text-slate-600'}`}>
                      {op.status}
                    </span>
                  </div>
                  <div className="text-sm text-slate-500 flex gap-4 flex-wrap mb-2">
                    <span>{op.recruiterName || 'Unknown'}</span>
                    {op.email && <span>{op.email}</span>}
                    <span className="text-xs text-slate-400">Score: {(op.relevanceScore * 100).toFixed(0)}%</span>
                    {op.postDate && <span className="text-xs text-slate-400">{op.postDate}</span>}
                  </div>
                  {op.postContent && (
                    <p className="text-xs text-slate-400 mb-2 line-clamp-2">{op.postContent.slice(0, 200)}</p>
                  )}
                  {editingId === op.id ? (
                    <div className="mt-2 space-y-2">
                      <input
                        type="text"
                        value={editSubject}
                        onChange={(e) => setEditSubject(e.target.value)}
                        placeholder="Email subject"
                        className="w-full px-2 py-1 text-sm border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 outline-none"
                      />
                      <textarea
                        value={editContent}
                        onChange={(e) => setEditContent(e.target.value)}
                        rows={6}
                        className="w-full px-2 py-1 text-sm border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 outline-none font-mono"
                      />
                      <div className="flex gap-2">
                        <button onClick={() => saveEdit(op)} className="px-3 py-1 bg-blue-600 text-white rounded text-xs hover:bg-blue-700">Save</button>
                        <button onClick={() => setEditingId(null)} className="px-3 py-1 bg-slate-200 text-slate-700 rounded text-xs hover:bg-slate-300">Cancel</button>
                      </div>
                    </div>
                  ) : op.generatedEmail ? (
                    <div className="mt-2 bg-slate-50 rounded-lg p-3">
                      <div className="text-xs font-medium text-slate-600 mb-1">Subject: {op.generatedSubject}</div>
                      <p className="text-xs text-slate-600 whitespace-pre-line line-clamp-3">{op.generatedEmail}</p>
                    </div>
                  ) : null}
                  <div className="flex gap-2 mt-3 flex-wrap">
                    {op.postUrl && (
                      <a href={op.postUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline">View Post</a>
                    )}
                    {op.recruiterProfileUrl && (
                      <a href={op.recruiterProfileUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline">Profile</a>
                    )}
                    {!op.generatedEmail && (
                      <button
                        onClick={() => generateEmails([op.id])}
                        className="text-xs text-purple-600 hover:underline"
                      >
                        Generate Email
                      </button>
                    )}
                    {op.generatedEmail && (
                      <button
                        onClick={() => { setEditingId(op.id); setEditContent(op.generatedEmail); setEditSubject(op.generatedSubject); }}
                        className="text-xs text-slate-600 hover:underline"
                      >
                        Edit
                      </button>
                    )}
                    {op.status === 'pending' && (
                      <>
                        <button onClick={() => updateStatus(op.id, 'approved', op.rowIndex)} className="text-xs text-green-600 hover:underline font-medium">Approve</button>
                        <button onClick={() => updateStatus(op.id, 'rejected', op.rowIndex)} className="text-xs text-red-600 hover:underline">Reject</button>
                      </>
                    )}
                    {op.status === 'approved' && (
                      <button onClick={() => updateStatus(op.id, 'rejected', op.rowIndex)} className="text-xs text-red-600 hover:underline">Reject</button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
