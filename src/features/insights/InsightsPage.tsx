import { useState } from 'react';
import { DashboardPage } from '@/features/dashboard/DashboardPage';
import { ReportsPage } from '@/features/reports/ReportsPage';

export function InsightsPage() {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'reports'>('dashboard');

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 border-b border-[var(--border)]">
        <button
          onClick={() => setActiveTab('dashboard')}
          className={`px-3 py-2 text-sm font-medium transition-colors ${
            activeTab === 'dashboard'
              ? 'border-b-2 border-[var(--teal)] text-[var(--teal)]'
              : 'text-[var(--muted)] hover:text-[var(--ink)]'
          }`}
        >
          Dashboard
        </button>
        <button
          onClick={() => setActiveTab('reports')}
          className={`px-3 py-2 text-sm font-medium transition-colors ${
            activeTab === 'reports'
              ? 'border-b-2 border-[var(--teal)] text-[var(--teal)]'
              : 'text-[var(--muted)] hover:text-[var(--ink)]'
          }`}
        >
          Reports
        </button>
      </div>

      <div>
        {activeTab === 'dashboard' && <DashboardPage />}
        {activeTab === 'reports' && <ReportsPage />}
      </div>
    </div>
  );
}
