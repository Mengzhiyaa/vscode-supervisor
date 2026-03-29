export type VariablesGrouping = 'none' | 'kind' | 'size';
export type VariablesSorting = 'name' | 'size' | 'recent';

export function decodeGrouping(wire: VariablesGrouping): number {
    switch (wire) {
        case 'kind':
            return 1;
        case 'size':
            return 2;
        case 'none':
        default:
            return 0;
    }
}

export function encodeGrouping(value: number): VariablesGrouping {
    switch (value) {
        case 1:
            return 'kind';
        case 2:
            return 'size';
        case 0:
        default:
            return 'none';
    }
}

export function decodeSorting(wire: VariablesSorting): number {
    switch (wire) {
        case 'size':
            return 1;
        case 'recent':
            return 2;
        case 'name':
        default:
            return 0;
    }
}

export function encodeSorting(value: number): VariablesSorting {
    switch (value) {
        case 1:
            return 'size';
        case 2:
            return 'recent';
        case 0:
        default:
            return 'name';
    }
}
