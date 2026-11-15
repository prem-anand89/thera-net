// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import type { Exercise } from '@/domain/hep';
import { PackList } from './PickerPacks';

vi.mock('./useHepData', () => ({ useThumbUrls: () => ({ k1: 'blob:pic' }) }));

const ex = { id: 'e1', title: 'Bridge', bodyRegion: 'Spine / Back', alsoRegions: [], mediaType: 'image', thumbKey: 'k1' } as unknown as Exercise;
afterEach(cleanup);

describe('PackList thumbnails', () => {
  const pack = (bodyRegion: string) => ({ id: 'p', title: 'Pack', meta: '', addable: 1, exercises: [{ title: 'Bridge', sourceExerciseId: 'e1', bodyRegion }] });
  it('shows the picture for an ordinary exercise', () => {
    const { container } = render(<PackList clinicId="c1" packs={[pack('Spine / Back')]} library={[ex]} empty="none" onAddAll={() => {}} />);
    expect(container.querySelector('img')).not.toBeNull();
  });
  it('hides it when the item itself is pelvic floor, even though the source exercise is not', () => {
    const { container } = render(<PackList clinicId="c1" packs={[pack('Pelvic floor: Women')]} library={[ex]} empty="none" onAddAll={() => {}} />);
    expect(container.querySelector('img')).toBeNull();
  });
});
