import { ActivityItem } from './activityItem';

export interface ConsoleErrorSuggestionDescriptor {
    id: string;
    iconId: string;
    label: string;
}

export class ActivityItemErrorSuggestion extends ActivityItem {
    constructor(
        id: string,
        parentId: string,
        when: Date,
        readonly suggestions: ConsoleErrorSuggestionDescriptor[],
        readonly available: boolean,
    ) {
        super(id, parentId, when);
    }

    getClipboardRepresentation(_commentPrefix: string): string[] {
        return [];
    }
}
