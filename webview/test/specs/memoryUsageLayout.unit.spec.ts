import { expect, test } from '@playwright/test';
import { getMemoryMeterLayout } from '../../src/variables/memoryUsageLayout';

test('memory meter degrades by semantic priority at narrow widths', () => {
    expect(getMemoryMeterLayout(120, false)).toBe('barAndLabel');
    expect(getMemoryMeterLayout(80, true)).toBe('labelAndWarning');
    expect(getMemoryMeterLayout(60, false)).toBe('label');
    expect(getMemoryMeterLayout(40, true)).toBe('hidden');
});
