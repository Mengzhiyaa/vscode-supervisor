import { expect, test } from '@playwright/test';
import { getMemoryMeterLayout, getMemoryMeterSizing } from '../../src/variables/memoryUsageLayout';

test('memory meter degrades by semantic priority at narrow widths', () => {
    expect(getMemoryMeterLayout(120, false)).toBe('barAndLabel');
    // The label needs 35px plus 28px for padding, gap, and arrow; warning adds 20px.
    expect(getMemoryMeterLayout(83, true)).toBe('labelAndWarning');
    expect(getMemoryMeterLayout(80, true)).toBe('label');
    expect(getMemoryMeterLayout(63, false)).toBe('label');
    expect(getMemoryMeterLayout(60, false)).toBe('hidden');
    expect(getMemoryMeterLayout(40, true)).toBe('hidden');
});

test('memory meter accounts for warning space at each layout boundary', () => {
    expect(getMemoryMeterSizing(116, true)).toEqual({
        layout: 'barAndLabel', width: 116, barWidth: 27, showWarning: true,
    });
    expect(getMemoryMeterSizing(115, true)).toEqual({
        layout: 'labelAndWarning', width: 83, showWarning: true,
    });
    expect(getMemoryMeterSizing(83, true)).toEqual({
        layout: 'labelAndWarning', width: 83, showWarning: true,
    });
    expect(getMemoryMeterSizing(82, true)).toEqual({
        layout: 'label', width: 63, showWarning: false,
    });
    expect(getMemoryMeterSizing(63, true)).toEqual({
        layout: 'label', width: 63, showWarning: false,
    });
    expect(getMemoryMeterSizing(62, true)).toEqual({
        layout: 'hidden', width: 0, showWarning: false,
    });
});

test('memory meter accounts for chrome at layout boundaries without a warning', () => {
    expect(getMemoryMeterSizing(96, false)).toEqual({
        layout: 'barAndLabel', width: 96, barWidth: 27, showWarning: false,
    });
    expect(getMemoryMeterSizing(95, false)).toEqual({
        layout: 'label', width: 63, showWarning: false,
    });
    expect(getMemoryMeterSizing(63, false)).toEqual({
        layout: 'label', width: 63, showWarning: false,
    });
    expect(getMemoryMeterSizing(62, false)).toEqual({
        layout: 'hidden', width: 0, showWarning: false,
    });
});

test('memory meter reserves the actual label width and caps the bar width', () => {
    expect(getMemoryMeterSizing(108, true, 60)).toEqual({
        layout: 'labelAndWarning', width: 108, showWarning: true,
    });
    expect(getMemoryMeterSizing(107, true, 60)).toEqual({
        layout: 'label', width: 88, showWarning: false,
    });
    expect(getMemoryMeterSizing(141, true, 60)).toEqual({
        layout: 'barAndLabel', width: 141, barWidth: 27, showWarning: true,
    });
    expect(getMemoryMeterSizing(300, true, 60)).toEqual({
        layout: 'barAndLabel', width: 214, barWidth: 100, showWarning: true,
    });
});
