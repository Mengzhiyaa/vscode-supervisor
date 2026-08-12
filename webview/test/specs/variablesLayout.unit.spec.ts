import { expect, test } from '@playwright/test';
import {
    calculateVariablesColumnLayout,
    getNameColumnBounds,
} from '../../src/variables/columnLayout';
import { calculateVirtualRange } from '../../src/variables/virtualList';

test('variables virtual range clamps offsets and overscans the viewport', () => {
    expect(calculateVirtualRange(10_000, 2_600, 260, 26, 10)).toEqual({
        start: 90,
        end: 120,
    });
    expect(calculateVirtualRange(5, -20, 260, 26, 10)).toEqual({
        start: 0,
        end: 5,
    });
    expect(calculateVirtualRange(0, 0, 100, 26, 10)).toEqual({
        start: 0,
        end: 0,
    });
});

test('variables column layout clamps safely at normal and narrow widths', () => {
    expect(getNameColumnBounds(600, 100)).toEqual({
        minimum: 100,
        maximum: 400,
    });
    expect(calculateVariablesColumnLayout(600, 500, 100, 250)).toEqual({
        nameWidth: 400,
        detailsWidth: 200,
        rightColumnVisible: false,
    });
    expect(calculateVariablesColumnLayout(90, 130, 100, 250)).toEqual({
        nameWidth: 60,
        detailsWidth: 30,
        rightColumnVisible: false,
    });
});
