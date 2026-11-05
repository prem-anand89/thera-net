// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TherapistFilter } from './TherapistFilter';

describe('TherapistFilter', () => {
  it('anchors the menu from the left on narrow viewports so it stays on screen', async () => {
    const user = userEvent.setup();
    render(
      <TherapistFilter
        therapists={[
          { id: 't1', name: 'Dr Aishwarya Rani', color: '#c00' },
          { id: 't2', name: 'Dr Prem Anand', color: '#0c0' },
        ]}
        visibleIds={[]}
        onToggle={() => {}}
        onShowAll={() => {}}
      />
    );
    await user.click(screen.getByRole('button', { expanded: false }));
    const panel = screen.getByText('Show therapists').parentElement!.parentElement!;
    expect(panel.className).toMatch(/left-0/);
    expect(panel.className).toMatch(/sm:right-0/);
  });
});
