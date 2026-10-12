import { useMemo, useState, type ReactNode } from 'react';
import { formatINR } from '@/domain/money';
import { MonthlyRevenueChart } from '@/components/MonthlyRevenueChart';
import { MonthlyVisitsChart } from '@/components/MonthlyVisitsChart';
import { RevenueTrendMonthTable } from '@/components/RevenueTrendMonthTable';
import { useCompactChart } from '@/components/useCompactChart';

function TrendSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="border-t border-[var(--border)] pt-4 first:border-t-0 first:pt-0">
      <h3 className="font-display text-sm font-semibold text-[var(--ink)]">{title}</h3>
      <div className="mt-3">{children}</div>
    </div>
  );
}

export function RevenueTrendPanel({
  categories,
  revenuePaise,
  visitCounts,
  revenueColumnLabel,
  currentMonthIndices,
}: {
  categories: string[];
  revenuePaise: number[];
  visitCounts: number[];
  revenueColumnLabel: string;
  currentMonthIndices: number[];
}) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const compact = useCompactChart();

  const shortCategories = useMemo(
    () =>
      categories.map((c) => {
        const parts = c.split(' ');
        return parts.length >= 2 ? parts[0] : c;
      }),
    [categories]
  );

  const chartCategories =
    compact || categories.length > 8
      ? shortCategories
      : categories;

  const tableActiveIndex = hoveredIndex ?? selectedIndex;

  return (
    <div className="space-y-4">
      <div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <MonthlyRevenueChart
            categories={chartCategories}
            fullCategories={categories}
            revenuePaise={revenuePaise}
            formatRevenue={formatINR}
            currentMonthIndices={currentMonthIndices}
            selectedIndex={selectedIndex}
            onSelectIndex={setSelectedIndex}
            hoveredIndex={hoveredIndex}
            onHoverIndex={setHoveredIndex}
          />
          <MonthlyVisitsChart
            categories={chartCategories}
            fullCategories={categories}
            visitCounts={visitCounts}
            currentMonthIndices={currentMonthIndices}
            selectedIndex={selectedIndex}
            onSelectIndex={setSelectedIndex}
            hoveredIndex={hoveredIndex}
            onHoverIndex={setHoveredIndex}
          />
        </div>
      </div>

      <TrendSection title="Month-by-month breakdown">
        <RevenueTrendMonthTable
          monthLabels={categories}
          revenuePaise={revenuePaise}
          visitCounts={visitCounts}
          revenueColumnLabel={revenueColumnLabel}
          selectedIndex={tableActiveIndex}
          onSelectIndex={setSelectedIndex}
          inProgressIndices={currentMonthIndices}
        />
      </TrendSection>
    </div>
  );
}
