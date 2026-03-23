/*---------------------------------------------------------------------------------------------
 *  LayoutManager - Port from Positron's layoutManager.ts
 *  Manages the layout of columns and rows in a Data Grid
 *
 * In this code:
 * index       - Represents the index of a column or row.
 * start       - Represents the X or Y coordinate of a column or row.
 * size        - Represents the width or height of a column or row.
 * end         - Represents the X or Y coordinate of the end of a column or row
 * defaultSize - Represents the default width or height of a column or row.
 * customSize  - Represents the custom width or height of a column or row (as set by a user).
 *--------------------------------------------------------------------------------------------*/

/**
 * Maximum number of layout entries that supports advanced layout features. When this limit is
 * exceeded, layout manager falls back to a simplified layout strategy.
 */
export const MAX_ADVANCED_LAYOUT_ENTRY_COUNT = 10_000_000;

/**
 * ILayoutEntry interface.
 */
export interface ILayoutEntry {
    readonly index: number;
    readonly start: number;
    readonly size: number;
    readonly end: number;
}

/**
 * LayoutManager class.
 */
export class LayoutManager {
    //#region Private Properties

    private readonly _defaultSize: number = 0;
    private _entryCount: number = 0;
    private readonly _entrySizes = new Map<number, number>();
    private readonly _customEntrySizes = new Map<number, number>();
    private _entryMap: number[] = [];
    private readonly _inverseEntryMap = new Map<number, number>();
    private readonly _pinnedIndexes = new Set<number>();

    // Cached calculations
    private _pinnedLayoutEntriesSize: number | undefined;
    private _unpinnedLayoutEntriesSize: number | undefined;

    //#endregion Private Properties

    //#region Constructor

    constructor(defaultSize: number = 0) {
        this._defaultSize = defaultSize;
    }

    //#endregion Constructor

    //#region Public Properties

    get entryCount() {
        return this._entryCount;
    }

    get firstIndex() {
        if (!this._entryCount) {
            return -1;
        }

        if (!this._pinnedIndexes.size) {
            return this.mapPositionToIndex(0) ?? -1;
        }

        const firstIteratorResult = this._pinnedIndexes.values().next();
        return firstIteratorResult.done ? -1 : firstIteratorResult.value;
    }

    get lastIndex() {
        if (!this._entryCount) {
            return -1;
        }

        for (let position = this._entryCount - 1; position >= 0; position--) {
            const index = this.mapPositionToIndex(position);
            if (index === undefined) {
                return -1;
            }

            if (!this.isPinnedIndex(index)) {
                return index;
            }
        }

        let lastPinnedIndex: number | undefined;
        for (const pinned of this._pinnedIndexes) {
            lastPinnedIndex = pinned;
        }

        return lastPinnedIndex ?? -1;
    }

    get pinnedIndexesCount() {
        return this._pinnedIndexes.size;
    }

    get pinnedIndexes() {
        return Array.from(this._pinnedIndexes);
    }

    get pinnedLayoutEntriesSize() {
        if (this._pinnedLayoutEntriesSize !== undefined) {
            return this._pinnedLayoutEntriesSize;
        }

        let size = 0;
        for (const index of this._pinnedIndexes) {
            size += this.entrySize(index);
        }

        this._pinnedLayoutEntriesSize = size;
        return size;
    }

    get unpinnedLayoutEntriesSize() {
        if (this._unpinnedLayoutEntriesSize !== undefined) {
            return this._unpinnedLayoutEntriesSize;
        }

        let size = (this._entryCount - this._pinnedIndexes.size) * this._defaultSize;

        for (const [customEntrySizeIndex, customEntrySize] of this._customEntrySizes) {
            if (!this.isPinnedIndex(customEntrySizeIndex)) {
                size -= this._defaultSize;
                size += customEntrySize;
            }
        }

        for (const [entrySizeIndex, entrySize] of this._entrySizes) {
            if (!this.isPinnedIndex(entrySizeIndex) && !this._customEntrySizes.has(entrySizeIndex)) {
                size -= this._defaultSize;
                size += entrySize;
            }
        }

        this._unpinnedLayoutEntriesSize = size;
        return size;
    }

    //#endregion Public Properties

    //#region Public Methods

    setEntries(entryCount: number, entrySizes: number[] | undefined = undefined, entryMap: number[] | undefined = undefined) {
        this.invalidateCachedCalculations();

        this._entryCount = entryCount;
        this._entrySizes.clear();
        this._entryMap = [];
        this._inverseEntryMap.clear();

        if (this._entryCount <= MAX_ADVANCED_LAYOUT_ENTRY_COUNT) {
            if (entrySizes?.length === this._entryCount) {
                for (let i = 0; i < entrySizes.length; i++) {
                    this._entrySizes.set(i, entrySizes[i]);
                }
            }

            this._entryMap = entryMap?.length === this._entryCount ? entryMap : [];
            if (this._entryMap.length !== 0) {
                for (let position = 0; position < this._entryMap.length; position++) {
                    this._inverseEntryMap.set(this._entryMap[position], position);
                }
            }
        }

        for (const pinnedIndex of this._pinnedIndexes) {
            const pinnedIndexPosition = this.mapIndexToPosition(pinnedIndex);
            if (pinnedIndexPosition && (pinnedIndexPosition < 0 || pinnedIndexPosition >= this._entryCount)) {
                this._pinnedIndexes.delete(pinnedIndex);
            }
        }
    }

    setPinnedIndexes(pinnedIndexes: number[]) {
        this._pinnedIndexes.clear();
        for (const index of pinnedIndexes) {
            this.pinIndex(index);
        }
    }

    getLayoutIndexes(layoutOffset: number, layoutSize: number, overscanFactor: number) {
        if (layoutOffset < 0 || layoutSize < 0) {
            return [];
        }

        const layoutIndexes = this.pinnedIndexes;
        const firstUnpinnedLayoutEntry = this.findFirstUnpinnedLayoutEntry(layoutOffset);
        if (firstUnpinnedLayoutEntry === undefined) {
            return layoutIndexes;
        }

        layoutIndexes.push(firstUnpinnedLayoutEntry.index);

        const firstLayoutEntryPosition = this.mapIndexToPosition(firstUnpinnedLayoutEntry.index);
        if (firstLayoutEntryPosition === undefined) {
            return layoutIndexes;
        }

        const startOffset = layoutOffset - (layoutSize * overscanFactor);
        let end = firstUnpinnedLayoutEntry.start;
        for (let position = firstLayoutEntryPosition - 1; position >= 0 && end > startOffset; position--) {
            const index = this.mapPositionToIndex(position);
            if (index === undefined) {
                return [];
            }

            if (this.isPinnedIndex(index)) {
                continue;
            }

            layoutIndexes.push(index);
            end -= this.entrySize(index);
        }

        const endOffset = layoutOffset + layoutSize + (layoutSize * overscanFactor);
        let start = firstUnpinnedLayoutEntry.end;
        for (let position = firstLayoutEntryPosition + 1; position < this._entryCount && start < endOffset; position++) {
            const index = this.mapPositionToIndex(position);
            if (index === undefined) {
                return [];
            }

            if (this.isPinnedIndex(index)) {
                continue;
            }

            layoutIndexes.push(index);
            start += this.entrySize(index);
        }

        return layoutIndexes;
    }

    mapPositionToIndex(position: number): number | undefined {
        if (position < 0 || position >= this._entryCount) {
            return undefined;
        }

        if (this._pinnedIndexes.size === 0) {
            if (this._entryMap.length === 0) {
                return position;
            }
            return this._entryMap[position];
        }

        if (position < this._pinnedIndexes.size) {
            return Array.from(this._pinnedIndexes)[position];
        }

        const rank = position - this._pinnedIndexes.size;
        if (rank >= this._entryCount - this._pinnedIndexes.size) {
            return undefined;
        }

        const target = rank + 1;
        let leftPosition = 0;
        let rightPosition = this._entryCount - 1;
        let candidatePosition = -1;
        while (leftPosition <= rightPosition) {
            const middlePosition = (leftPosition + rightPosition) >>> 1;
            const pinnedPositionsAtOrBeforeMiddlePosition = this.pinnedPositionsAtOrBefore(middlePosition);
            if (pinnedPositionsAtOrBeforeMiddlePosition === undefined) {
                return undefined;
            }

            if ((middlePosition + 1) - pinnedPositionsAtOrBeforeMiddlePosition >= target) {
                candidatePosition = middlePosition;
                rightPosition = middlePosition - 1;
            } else {
                leftPosition = middlePosition + 1;
            }
        }

        return candidatePosition === -1 ? undefined : this._entryMap.length !== 0 ? this._entryMap[candidatePosition] : candidatePosition;
    }

    /**
     * Maps a range of positions to their corresponding indexes.
     * @param startingPosition The starting position, inclusive.
     * @param endingPosition The ending position, inclusive.
     * @returns An array of indexes corresponding to the specified positions, or undefined if the positions are invalid.
     */
    mapPositionsToIndexes(startingPosition: number, endingPosition: number): number[] | undefined {
        // Validate the starting position and ending position.
        if (startingPosition < 0 || endingPosition < startingPosition || endingPosition >= this._entryCount) {
            return undefined;
        }

        // If there are no pinned indexes, positions map directly to indexes. This means we can simply
        // enumerate the positions and return the indexes or the entry-mapped indexes.
        if (this._pinnedIndexes.size === 0) {
            // Build the indexes or the entry-mapped indexes.
            const indexes: number[] = [];
            if (this._entryMap.length === 0) {
                // Build the indexes.
                for (let index = startingPosition; index <= endingPosition; index++) {
                    indexes.push(index);
                }
            } else {
                // Build the entry-mapped indexes.
                for (let position = startingPosition; position <= endingPosition; position++) {
                    const entryMappedIndex = this._entryMap[position];
                    if (entryMappedIndex === undefined) {
                        return undefined;
                    } else {
                        indexes.push(entryMappedIndex);
                    }
                }

                // Return the indexes.
                return indexes;
            }
        }

        // Add pinned indexes.
        const indexes: number[] = [];
        const pinnedIndexesArray = Array.from(this._pinnedIndexes);
        while (startingPosition < pinnedIndexesArray.length && startingPosition <= endingPosition) {
            indexes.push(pinnedIndexesArray[startingPosition++]);
        }

        // Add unpinned indexes.
        if (startingPosition <= endingPosition) {
            /**
             * Checks if a position is pinned.
             * @param position The position to check.
             * @returns true if the position is pinned; otherwise, false.
             */
            const isPinnedPosition = (position: number) => {
                if (this._entryMap.length === 0) {
                    return this.isPinnedIndex(position);
                } else {
                    const entryMappedIndex = this._entryMap[position];
                    return entryMappedIndex !== undefined && this.isPinnedIndex(entryMappedIndex);
                }
            };

            // Compute the rank of the unpinned position within the unpinned indexes.
            const rank = startingPosition - this._pinnedIndexes.size;
            if (rank >= this._entryCount - this._pinnedIndexes.size) {
                return undefined;
            }

            // Binary search to the first candidate position.
            const target = rank + 1;
            let leftPosition = 0;
            let rightPosition = this._entryCount - 1;
            let candidatePosition = -1;
            while (leftPosition <= rightPosition) {
                // Calculate the middle position.
                const middlePosition = (leftPosition + rightPosition) >>> 1;

                // Calculate the number of pinned positions at or before middle position.
                const pinnedPositionsAtOrBeforeMiddlePosition = this.pinnedPositionsAtOrBefore(middlePosition);
                if (pinnedPositionsAtOrBeforeMiddlePosition === undefined) {
                    return undefined;
                }

                // Determine whether to search left or right.
                if ((middlePosition + 1) - pinnedPositionsAtOrBeforeMiddlePosition >= target) {
                    candidatePosition = middlePosition;
                    rightPosition = middlePosition - 1;
                } else {
                    leftPosition = middlePosition + 1;
                }
            }

            // Ensure that a candidate position was found.
            if (candidatePosition === -1) {
                return undefined;
            }

            // The candidate position should be an unpinned position. If not, advance to the next unpinned position.
            while (candidatePosition < this._entryCount && isPinnedPosition(candidatePosition)) {
                candidatePosition++;
            }

            // Add unpinned indexes.
            while (startingPosition <= endingPosition) {
                // If the candidate position is invalid, return undefined.
                if (candidatePosition >= this._entryCount) {
                    return undefined;
                }

                // Get the index of the candidate position.
                const index = this._entryMap.length === 0 ? candidatePosition : this._entryMap[candidatePosition];
                if (index === undefined) {
                    return undefined;
                }

                // Push the index.
                indexes.push(index);

                // Advance to the next starting position and the next candidate position.
                startingPosition++;
                do {
                    candidatePosition++;
                } while (candidatePosition < this._entryCount && isPinnedPosition(candidatePosition));
            }
        }

        // Return the indexes.
        return indexes;
    }

    mapIndexToPosition(index: number): number | undefined {
        if (index < 0) {
            return undefined;
        }

        if (this._pinnedIndexes.size === 0) {
            if (this._entryMap.length === 0) {
                if (index >= this._entryCount) {
                    return undefined;
                }
                return index;
            }
            return this._inverseEntryMap.get(index);
        }

        if (this._pinnedIndexes.has(index)) {
            return Array.from(this._pinnedIndexes).indexOf(index);
        }

        const position = this.positionOfIndex(index);
        if (position === undefined) {
            return undefined;
        }

        const pinnedPositionsBefore = position > 0 ? this.pinnedPositionsAtOrBefore(position - 1) : 0;
        if (pinnedPositionsBefore === undefined) {
            return undefined;
        }

        return this._pinnedIndexes.size + (position - pinnedPositionsBefore);
    }

    setSizeOverride(index: number, sizeOverride: number) {
        if (!this.validateIndex(index) || sizeOverride <= 0) {
            return;
        }

        if (this._customEntrySizes.get(index) === sizeOverride) {
            return;
        }

        this._customEntrySizes.set(index, sizeOverride);
        this.invalidateCachedCalculations();
    }

    clearSizeOverride(index: number) {
        if (!this.validateIndex(index)) {
            return;
        }

        if (!this._customEntrySizes.has(index)) {
            return;
        }

        this._customEntrySizes.delete(index);
        this.invalidateCachedCalculations();
    }

    isPinnedIndex(index: number): boolean {
        return this._pinnedIndexes.has(index);
    }

    pinIndex(index: number) {
        if (!this.validateIndex(index)) {
            return false;
        }

        if (this.isPinnedIndex(index)) {
            return false;
        }

        this._pinnedIndexes.add(index);
        this.invalidateCachedCalculations();
        return true;
    }

    unpinIndex(index: number) {
        if (!this.validateIndex(index)) {
            return false;
        }

        if (!this.isPinnedIndex(index)) {
            return false;
        }

        this._pinnedIndexes.delete(index);
        this.invalidateCachedCalculations();
        return true;
    }

    pinnedLayoutEntries(layoutSize: number) {
        if (layoutSize <= 0) {
            return [];
        }

        let start = 0;
        const layoutEntries: ILayoutEntry[] = [];
        for (const index of this._pinnedIndexes) {
            const size = this.entrySize(index);
            layoutEntries.push({
                index,
                start,
                size,
                end: start + size
            });

            start += size;
            if (start > layoutSize) {
                break;
            }
        }

        return layoutEntries;
    }

    unpinnedLayoutEntries(layoutOffset: number, layoutSize: number): ILayoutEntry[] {
        if (layoutOffset < 0 || layoutSize < 0) {
            return [];
        }

        const firstLayoutEntry = this.findFirstUnpinnedLayoutEntry(layoutOffset);
        if (!firstLayoutEntry) {
            return [];
        }

        const layoutEntries: ILayoutEntry[] = [firstLayoutEntry];
        const layoutEnd = layoutOffset + layoutSize;

        for (let index = this.nextIndex(firstLayoutEntry.index), start = firstLayoutEntry.end; index !== undefined && start < layoutEnd; index = this.nextIndex(index)) {
            if (this.isPinnedIndex(index)) {
                continue;
            }

            const size = this.entrySize(index);
            layoutEntries.push({
                index,
                start,
                size,
                end: start + size
            });

            start += size;
        }

        return layoutEntries;
    }

    previousIndex(startingIndex: number): number | undefined {
        if (this.isPinnedIndex(startingIndex)) {
            const pinnedIndexesArray = Array.from(this._pinnedIndexes);
            const pinnedIndexPosition = pinnedIndexesArray.indexOf(startingIndex);

            if (pinnedIndexPosition > 0) {
                return pinnedIndexesArray[pinnedIndexPosition - 1];
            }
            return undefined;
        }

        if (this._entryMap.length === 0) {
            for (let i = startingIndex - 1; i >= 0; i--) {
                if (!this.isPinnedIndex(i)) {
                    return i;
                }
            }
        } else {
            let position = this._inverseEntryMap.get(startingIndex);
            if (position === undefined) {
                return undefined;
            }

            while (--position >= 0) {
                const entryMapIndex = this._entryMap[position];
                if (!this.isPinnedIndex(entryMapIndex)) {
                    return entryMapIndex;
                }
            }
        }

        let lastPinnedIndex: number | undefined;
        for (const pinnedIndex of this._pinnedIndexes) {
            lastPinnedIndex = pinnedIndex;
        }
        return lastPinnedIndex;
    }

    nextIndex(startingIndex: number): number | undefined {
        if (!this.validateIndex(startingIndex)) {
            return undefined;
        }

        if (this.isPinnedIndex(startingIndex)) {
            const pinnedIndexesArray = Array.from(this._pinnedIndexes);
            const pinnedPosition = pinnedIndexesArray.indexOf(startingIndex);
            if (pinnedPosition === -1) {
                return undefined;
            }

            if (pinnedPosition < pinnedIndexesArray.length - 1) {
                return pinnedIndexesArray[pinnedPosition + 1];
            }

            for (let position = 0; position < this._entryCount; position++) {
                const index = this.mapPositionToIndex(position);
                if (index === undefined) {
                    return undefined;
                }

                if (!this.isPinnedIndex(index)) {
                    return index;
                }
            }
            return undefined;
        }

        if (this._entryMap.length === 0) {
            for (let i = startingIndex + 1; i < this._entryCount; i++) {
                if (!this.isPinnedIndex(i)) {
                    return i;
                }
            }
        } else {
            let entryMapPosition = this._inverseEntryMap.get(startingIndex);
            if (entryMapPosition === undefined) {
                return undefined;
            }

            while (++entryMapPosition < this._entryMap.length) {
                const indexAtPosition = this._entryMap[entryMapPosition];
                if (!this.isPinnedIndex(indexAtPosition)) {
                    return indexAtPosition;
                }
            }
        }

        return undefined;
    }

    getLayoutEntry(layoutEntryIndex: number): ILayoutEntry | undefined {
        if (!this.validateIndex(layoutEntryIndex)) {
            return undefined;
        }

        if (this.isPinnedIndex(layoutEntryIndex)) {
            const pinnedIndexesArray = Array.from(this._pinnedIndexes);
            const pinnedIndexPosition = pinnedIndexesArray.indexOf(layoutEntryIndex);
            if (pinnedIndexPosition === -1) {
                return undefined;
            }

            let start = 0;
            for (let position = 0; position < pinnedIndexPosition; position++) {
                start += this.entrySize(pinnedIndexesArray[position]);
            }

            const size = this.entrySize(layoutEntryIndex);
            return {
                index: layoutEntryIndex,
                start,
                size,
                end: start + size,
            };
        }

        const layoutEntryPosition = this.mapIndexToPosition(layoutEntryIndex);
        if (layoutEntryPosition === undefined) {
            return undefined;
        }

        let start = layoutEntryPosition * this._defaultSize;

        for (const pinnedIndex of this._pinnedIndexes) {
            const pinnedIndexPosition = this.mapIndexToPosition(pinnedIndex);
            if (pinnedIndexPosition === undefined) {
                continue;
            }

            if (pinnedIndexPosition < layoutEntryPosition) {
                start -= this._defaultSize;
            }
        }

        for (const [customEntrySizeIndex, customEntrySize] of this._customEntrySizes) {
            if (this.isPinnedIndex(customEntrySizeIndex)) {
                continue;
            }

            const customEntrySizePosition = this.mapIndexToPosition(customEntrySizeIndex);
            if (customEntrySizePosition === undefined) {
                continue;
            }

            if (customEntrySizePosition < layoutEntryPosition) {
                start -= this._defaultSize;
                start += customEntrySize;
            }
        }

        for (const [entrySizeIndex, entrySize] of this._entrySizes) {
            if (this.isPinnedIndex(entrySizeIndex) || this._customEntrySizes.has(entrySizeIndex)) {
                continue;
            }

            const entrySizePosition = this.mapIndexToPosition(entrySizeIndex);
            if (entrySizePosition === undefined) {
                continue;
            }

            if (entrySizePosition < layoutEntryPosition) {
                start -= this._defaultSize;
                start += entrySize;
            }
        }

        const size = this.entrySize(layoutEntryIndex);
        return {
            index: layoutEntryIndex,
            start,
            size,
            end: start + size,
        };
    }

    findFirstUnpinnedLayoutEntry(layoutOffset: number): ILayoutEntry | undefined {
        if (!this._entryCount || layoutOffset < 0) {
            return undefined;
        }

        if (layoutOffset === 0 && this._defaultSize === 0 && this._entryCount === 1) {
            return {
                index: 0,
                start: 0,
                size: 0,
                end: 0,
            };
        }

        const pinnedIndexes = Array.from(this._pinnedIndexes);
        const customEntrySizes = [...this._customEntrySizes.entries()].filter(([customEntrySizeIndex]) => !this.isPinnedIndex(customEntrySizeIndex));
        const entrySizes = [...this._entrySizes.entries()].filter(([entrySizeIndex]) => !this.isPinnedIndex(entrySizeIndex) && !this._customEntrySizes.has(entrySizeIndex));

        let leftPosition = 0;
        let rightPosition = this._entryCount - 1;
        while (leftPosition <= rightPosition) {
            const middlePosition = (leftPosition + rightPosition) >> 1;
            const middleIndex = this.mapPositionToIndex(middlePosition);
            if (middleIndex === undefined) {
                return undefined;
            }

            let start = middlePosition * this._defaultSize;

            for (let i = 0; i < pinnedIndexes.length; i++) {
                const pinnedIndexPosition = this.mapIndexToPosition(pinnedIndexes[i]);
                if (pinnedIndexPosition !== undefined && pinnedIndexPosition < middlePosition) {
                    start -= this._defaultSize;
                }
            }

            for (const [customEntrySizeIndex, customEntrySize] of customEntrySizes) {
                const customEntrySizePosition = this.mapIndexToPosition(customEntrySizeIndex);
                if (customEntrySizePosition === undefined) {
                    continue;
                }

                if (customEntrySizePosition < middlePosition) {
                    start -= this._defaultSize;
                    start += customEntrySize;
                }
            }

            for (const [entrySizeIndex, entrySize] of entrySizes) {
                const entrySizePosition = this.mapIndexToPosition(entrySizeIndex);
                if (entrySizePosition === undefined) {
                    continue;
                }

                if (entrySizePosition < middlePosition) {
                    start -= this._defaultSize;
                    start += entrySize;
                }
            }

            if (layoutOffset < start) {
                rightPosition = middlePosition - 1;
                continue;
            }

            if (layoutOffset >= start && layoutOffset < start + this.entrySize(middleIndex)) {
                let firstUnpinnedIndex = middleIndex;

                if (this.isPinnedIndex(firstUnpinnedIndex)) {
                    let backwardScanPosition = middlePosition;
                    while (--backwardScanPosition >= 0) {
                        const index = this.mapPositionToIndex(backwardScanPosition);
                        if (index === undefined) {
                            return undefined;
                        }

                        if (!this.isPinnedIndex(index)) {
                            firstUnpinnedIndex = index;
                            break;
                        }
                    }

                    if (backwardScanPosition === -1) {
                        let forwardScanPosition = middlePosition;
                        while (++forwardScanPosition < this._entryCount) {
                            const index = this.mapPositionToIndex(forwardScanPosition);
                            if (index === undefined) {
                                return undefined;
                            }

                            if (!this.isPinnedIndex(index)) {
                                firstUnpinnedIndex = index;
                                break;
                            }
                        }

                        if (forwardScanPosition === this._entryCount) {
                            return undefined;
                        }
                    }
                }

                const size = this.entrySize(firstUnpinnedIndex);
                return {
                    index: firstUnpinnedIndex,
                    start,
                    size,
                    end: start + size,
                };
            }

            leftPosition = middlePosition + 1;
        }

        return undefined;
    }

    //#endregion Public Methods

    //#region Private Methods

    private validateIndex(index: number) {
        if (!Number.isInteger(index) || index < 0) {
            return false;
        }

        return this._entryMap.length !== 0 ? this._inverseEntryMap.has(index) : index < this._entryCount;
    }

    private invalidateCachedCalculations() {
        this._pinnedLayoutEntriesSize = undefined;
        this._unpinnedLayoutEntriesSize = undefined;
    }

    private entrySize(index: number): number {
        const customSize = this._customEntrySizes.get(index);
        if (customSize !== undefined) {
            return customSize;
        }

        const entrySize = this._entrySizes.get(index);
        if (entrySize !== undefined) {
            return entrySize;
        }

        return this._defaultSize;
    }

    private positionOfIndex(index: number): number | undefined {
        if (this._entryMap.length === 0) {
            if (index >= this._entryCount) {
                return undefined;
            }
            return index;
        }

        return this._inverseEntryMap.get(index);
    }

    private pinnedPositionsAtOrBefore(position: number): number | undefined {
        let count = 0;
        for (const pinnedIndex of this._pinnedIndexes) {
            const positionOfIndex = this.positionOfIndex(pinnedIndex);
            if (positionOfIndex === undefined) {
                return undefined;
            }

            if (positionOfIndex <= position) {
                count++;
            }
        }

        return count;
    }

    //#endregion Private Methods
}
