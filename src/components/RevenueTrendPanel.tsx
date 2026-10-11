import { useMemo, useState, type ReactNode } from 'react';
import { formatINR } from '@/domain/money';
import { RevenueWaterfallChart } from '@/components/RevenueWaterfallChart';
import { MonthlyRevenueChart } from '@/components/MonthlyRevenueChart';
import { MonthlyVisitsChart } from '@/components/MonthlyVisitsChart';
import { RevenueTrendMonthTable } from '@/components/RevenueTrendMonthTable';
import { useCompactChart } from '@/components/useCompactChart';

function TrendSection({
  kicker,
  title,
  children,
}: {
  kicker: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="border-t border-[var(--border)] pt-4 first:border-t-0 first:pt-0">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">{kicker}</p>
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
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
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

  return (
    <div className="space-y-1">
      <TrendSection kicker="Revenue growth" title="How much did revenue move vs last month?">
        <p className="mb-2 text-xs text-[var(--muted)]">
          Green = more revenue than the prior month; red = less. Visits are not shown here.
        </p>
        <RevenueWaterfallChart
          categories={chartCategories}
          fullCategories={categories}
          revenuePaise={revenuePaise}
          formatValue={formatINR}
          compact={compact}
          selectedCategoryIndex={activeIndex}
          onCategoryHover={setActiveIndex}
        />
      </TrendSection>

      <TrendSection kicker="Volume & earnings" title="Visits and revenue each month">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <MonthlyRevenueChart
            categories={chartCategories}
            fullCategories={categories}
            revenuePaise={revenuePaise}
            formatRevenue={formatINR}
            currentMonthIndices={currentMonthIndices}
            selectedIndex={activeIndex}
            onSelectIndex={setActiveIndex}
          />
          <MonthlyVisitsChart
            categories={chartCategories}
            fullCategories={categories}
            visitCounts={visitCounts}
            currentMonthIndices={currentMonthIndices}
            selectedIndex={activeIndex}
            onSelectIndex={setActiveIndex}
          />
        </div>
      </TrendSection>

      <TrendSection kicker="Month detail" title="Numbers behind the charts">
        <RevenueTrendMonthTable
          monthLabels={categories}
          revenuePaise={revenuePaise}
          visitCounts={visitCounts}
          revenueColumnLabel={revenueColumnLabel}
          selectedIndex={activeIndex}
          onSelectIndex={setActiveIndex}
          inProgressIndices={currentMonthIndices}
        />
      </TrendSection>
    </div>
  );
}
