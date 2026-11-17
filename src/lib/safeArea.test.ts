import { describe, expect, it } from 'vitest';
import { mainContentTopPadding, PRINT_BACK_TOUCH, PRINT_EARLY_RETURN_SAFE, PRINT_TOOLBAR_SAFE } from './safeArea';

describe('mainContentTopPadding', () => {
  it('adds safe-area top padding on phones when the app header is hidden', () => {
    expect(mainContentTopPadding('/visits/new')).toContain('safe-area-inset-top');
    expect(mainContentTopPadding('/workspace')).not.toContain('safe-area-inset-top');
    expect(mainContentTopPadding('/workspace')).toContain('pt-3');
  });
});

describe('print safe-area helpers', () => {
  it('clears the iOS status bar and notch on print toolbars and early returns', () => {
    expect(PRINT_TOOLBAR_SAFE).toContain('safe-area-inset-top');
    expect(PRINT_TOOLBAR_SAFE).toContain('safe-area-inset-left');
    expect(PRINT_TOOLBAR_SAFE).toContain('safe-area-inset-right');
    expect(PRINT_EARLY_RETURN_SAFE).toContain('safe-area-inset-top');
    expect(PRINT_BACK_TOUCH).toContain('max-sm:min-h-11');
  });
});