import type { ActionsIndex } from './actions-indexer.js';

let currentIndex: ActionsIndex | null = null;

export function setActionsIndex(idx: ActionsIndex) {
    currentIndex = idx;
}

export function getActionsIndex(): ActionsIndex {
    if (!currentIndex) throw new Error('Actions index not initialized');
    return currentIndex;
}