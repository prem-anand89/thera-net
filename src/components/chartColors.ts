// Reference categorical palette — all 8 validated slots in fixed order,
// assigned by index and never cycled (a 9th series would repeat hues and
// break CVD separation; fold into "Other" before that ever happens).
// Single source so ReportsOverviewPage, TherapistComparisonCard and PieChart
// can't drift onto two different palettes for the same series.
//
// Softened toward the surface (blend t=0.13 toward white, yellow left
// unblended to stay inside the lightness band) from the dataviz skill's
// validated reference order — order matters here as much as hue: it's
// what keeps adjacent slices/bars apart under color-vision deficiency,
// so don't reorder without re-running scripts/validate_palette.js.
export const SERIES_COLORS = [
  '#468adb', // blue
  '#ee7c4e', // orange
  '#39b98b', // aqua
  '#eda100', // yellow
  '#eb8cb0', // magenta
  '#219321', // green
  '#6254b2', // violet
  '#e76160', // red
];
