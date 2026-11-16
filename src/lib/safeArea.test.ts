import { describe, expect, it } from 'vitest';
import { mainContentTopPadding } from './safeArea';

describe('mainContentTopPadding', () => {
  it('adds safe-area top padding on phones when the app header is hidden', () => {
    expect(mainContentTopPadding('/visits/new')).toContain('safe-area-inset-top');
    expect(mainContentTopPadding('/workspace')).not.toContain('safe-area-inset-top');
    expect(mainContentTopPadding('/workspace')).toContain('pt-3');
  });
});