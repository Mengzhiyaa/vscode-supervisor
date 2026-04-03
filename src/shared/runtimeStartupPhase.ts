export enum RuntimeStartupPhase {
    Initializing = 'initializing',
    AwaitingTrust = 'awaitingTrust',
    Reconnecting = 'reconnecting',
    NewFolderTasks = 'newFolderTasks',
    Starting = 'starting',
    Discovering = 'discovering',
    Complete = 'complete',
}
