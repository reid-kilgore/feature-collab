// Editor state management

// Global state
export const state = {
    content: '',
    filename: 'document.md',
    isModified: false,
    loadedFromUrl: false,

    // Selection state
    pendingStart: 0,
    pendingEnd: 0,
    pendingText: '',
    pendingMatchCount: 1,
    selectionFromPreview: false,

    // UI state
    editingIndex: -1,
    activeCommentIndex: -1,
    userHidAnnotations: false,
    hadAnnotationsBefore: false
};

// Callbacks for state changes
const listeners = {
    contentChange: [],
    modifiedChange: [],
    selectionChange: []
};

/**
 * Initialize editor state
 */
export function initState(content = '', filename = 'document.md', fromUrl = false) {
    state.content = content;
    state.filename = filename;
    state.loadedFromUrl = fromUrl;
    state.isModified = false;
    state.editingIndex = -1;
    state.activeCommentIndex = -1;

    notifyListeners('contentChange');
    notifyListeners('modifiedChange');
}

/**
 * Update content and mark as modified
 */
export function setContent(content) {
    state.content = content;
    state.isModified = true;
    notifyListeners('contentChange');
    notifyListeners('modifiedChange');
}

/**
 * Set selection range
 */
export function setSelection(start, end, fromPreview = false, text = '', matchCount = 1) {
    state.pendingStart = start;
    state.pendingEnd = end;
    state.selectionFromPreview = fromPreview;
    state.pendingText = text;
    state.pendingMatchCount = matchCount;
    notifyListeners('selectionChange');
}

/**
 * Clear selection
 */
export function clearSelection() {
    state.pendingStart = 0;
    state.pendingEnd = 0;
    state.selectionFromPreview = false;
    state.pendingText = '';
    state.pendingMatchCount = 1;
}

/**
 * Mark document as saved
 */
export function markSaved() {
    state.isModified = false;
    notifyListeners('modifiedChange');
}

/**
 * Set the editing index for comment editing
 */
export function setEditingIndex(index) {
    state.editingIndex = index;
}

/**
 * Set the active comment index
 */
export function setActiveComment(index) {
    state.activeCommentIndex = index;
}

/**
 * Track annotation pane visibility preference
 */
export function setUserHidAnnotations(hidden) {
    state.userHidAnnotations = hidden;
}

/**
 * Track if we've ever had annotations
 */
export function setHadAnnotations(had) {
    state.hadAnnotationsBefore = had;
}

/**
 * Add a listener for state changes
 */
export function addListener(event, callback) {
    if (listeners[event]) {
        listeners[event].push(callback);
    }
}

/**
 * Remove a listener
 */
export function removeListener(event, callback) {
    if (listeners[event]) {
        listeners[event] = listeners[event].filter(cb => cb !== callback);
    }
}

/**
 * Notify all listeners of an event
 */
function notifyListeners(event) {
    if (listeners[event]) {
        listeners[event].forEach(cb => cb(state));
    }
}

/**
 * Calculate line and column from position
 */
export function getPositionInfo(text, pos) {
    const textBefore = text.substring(0, pos);
    const lines = textBefore.split('\n');
    return {
        line: lines.length,
        column: lines[lines.length - 1].length + 1
    };
}

/**
 * Calculate word count and annotation stats
 */
export function getStats(text, annotations) {
    const words = text.trim().split(/\s+/).filter(w => w).length;
    const highlights = annotations.length;
    const comments = annotations.filter(a => a.comment).length;

    return { words, highlights, comments };
}
