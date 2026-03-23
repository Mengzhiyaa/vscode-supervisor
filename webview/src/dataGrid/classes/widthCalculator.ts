/*---------------------------------------------------------------------------------------------
 *  Width Calculator - Canvas-based text measurement for column auto-sizing
 *  Port from Positron's columnHeaderWidthCalculator
 *--------------------------------------------------------------------------------------------*/

/**
 * Width calculator configuration
 */
export interface WidthCalculatorConfig {
    /** Font for column names */
    columnNameFont: string;
    /** Font for type names */
    typeNameFont: string;
    /** Font for sort index (tabular-nums) */
    sortIndexFont: string;
    /** Horizontal cell padding (applied twice) */
    horizontalCellPadding: number;
    /** Width of the sorting button */
    sortingButtonWidth: number;
    /** Width of the sort indicator icon */
    sortIndicatorWidth: number;
}

/**
 * Default configuration values
 */
export const DEFAULT_WIDTH_CONFIG: WidthCalculatorConfig = {
    columnNameFont: '600 12px var(--vscode-editor-font-family, monospace)',
    typeNameFont: '400 11px var(--vscode-editor-font-family, monospace)',
    sortIndexFont: '600 10px var(--vscode-editor-font-family, monospace)',
    horizontalCellPadding: 8,
    sortingButtonWidth: 20,
    sortIndicatorWidth: 20,
};

/**
 * WidthCalculator - Measures text width using canvas for column auto-sizing
 */
export class WidthCalculator {
    private canvas: HTMLCanvasElement;
    private ctx: CanvasRenderingContext2D | null;
    private config: WidthCalculatorConfig;
    private sortIndexWidth: number = 0;

    constructor(config: Partial<WidthCalculatorConfig> = {}) {
        this.config = { ...DEFAULT_WIDTH_CONFIG, ...config };
        this.canvas = document.createElement('canvas');
        this.ctx = this.canvas.getContext('2d');
        this.calculateSortIndexWidth();
    }

    /**
     * Pre-calculate the width of a 2-digit sort index
     */
    private calculateSortIndexWidth(): void {
        if (this.ctx) {
            this.ctx.font = this.config.sortIndexFont;
            this.sortIndexWidth = this.ctx.measureText('99').width;
        }
    }

    /**
     * Update configuration (e.g., when fonts change)
     */
    updateConfig(config: Partial<WidthCalculatorConfig>): void {
        this.config = { ...this.config, ...config };
        this.calculateSortIndexWidth();
    }

    /**
     * Calculate the width needed for a column header
     * @param columnName The column name text
     * @param typeName The type name text
     * @returns The calculated width in pixels
     */
    calculateColumnHeaderWidth(columnName: string, typeName: string): number {
        // Base width components
        const baseWidth =
            (this.config.horizontalCellPadding * 2) +  // Left + right padding
            this.sortIndexWidth +                       // Sort index (e.g., "1", "2")
            6 +                                         // Sort index padding
            this.config.sortIndicatorWidth +            // Sort indicator icon
            this.config.sortingButtonWidth +            // Sorting button
            1;                                          // Border

        // If no text, return base width
        if (!columnName && !typeName) {
            return baseWidth;
        }

        if (!this.ctx) {
            return baseWidth + 100; // Fallback width
        }

        // Measure column name width
        let columnNameWidth = 0;
        if (columnName) {
            this.ctx.font = this.config.columnNameFont;
            columnNameWidth = this.ctx.measureText(columnName).width;
        }

        // Measure type name width
        let typeNameWidth = 0;
        if (typeName) {
            this.ctx.font = this.config.typeNameFont;
            typeNameWidth = this.ctx.measureText(typeName).width;
        }

        // Return max of both widths plus base components
        return Math.ceil(Math.max(columnNameWidth, typeNameWidth) + baseWidth);
    }

    /**
     * Calculate the width needed for a cell value
     * @param textLength The length of the text (number of characters)
     * @param spaceWidth The width of a single space character
     * @returns The calculated width in pixels
     */
    calculateCellValueWidth(textLength: number, spaceWidth: number): number {
        return Math.ceil(
            (spaceWidth * textLength) +
            (this.config.horizontalCellPadding * 2) +
            1 // Border
        );
    }

    /**
     * Get the current space width for editor font
     * This should be called after setting the editor font on context
     */
    measureSpaceWidth(font: string): number {
        if (!this.ctx) return 8; // Fallback
        this.ctx.font = font;
        return this.ctx.measureText(' ').width;
    }

    /**
     * Dispose of canvas resources
     */
    dispose(): void {
        // Canvas will be garbage collected
        this.ctx = null;
    }
}

/**
 * Create font string from CSS values
 */
export function createFontString(
    weight: string | number,
    size: string | number,
    family: string
): string {
    const sizeStr = typeof size === 'number' ? `${size}px` : size;
    return `${weight} ${sizeStr} ${family}`;
}

/**
 * Get computed font from an element
 */
export function getComputedFont(element: Element): string {
    const style = getComputedStyle(element);
    return style.font || `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
}
