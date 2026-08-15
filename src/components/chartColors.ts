// Reference categorical palette — all 8 validated slots in fixed order,
// assigned by index and never cycled (a 9th series would repeat hues and
// break CVD separation; fold into "Other" before that ever happens).
// Single source so DashboardPage and TherapistComparisonCard can't drift
// onto two different palettes for the same series.
export const SERIES_COLORS = [
  '#2a78d6', // blue
  '#1baf7a', // aqua
  '#eda100', // yellow
  '#008300', // green
  '#4a3aa7', // violet
  '#e34948', // red
  '#e87ba4', // magenta
  '#eb6834', // orange
];
