// Main entry point for mdannotate web app

import '../styles/main.css';
import { initState, state, setHadAnnotations } from './editor.js';
import { loadFromHash, stripHeader } from './url.js';
import { getAnnotations } from './annotations.js';
import {
    initUI, setEditorContent, showWelcome, updateTitle, updateAll,
    toolbarAddHighlight, openCommentModal, submitComment, closeModal,
    jumpToAnnotation, editCommentAt, deleteAnnotationAt, clearAllAnnotationsAction,
    toggleSource, togglePreview, toggleAnnotations,
    showHelp, closeHelp, openFilePicker, downloadFile, copyShareUrl, copyTerminalCommand,
    closeTerminalModal, saveDefault, setSaveMode
} from './ui.js';

// Initialize the application
async function init() {
    // Set up UI first
    initUI();

    // Try to load from URL hash
    try {
        const hashData = await loadFromHash();
        if (hashData) {
            initState(hashData.content, hashData.filename, true);
            setEditorContent(hashData.content);
            updateTitle(hashData.filename, true);
            showWelcome(false);

            // Check if document has annotations
            if (getAnnotations(hashData.content).length > 0) {
                setHadAnnotations(true);
            }

            updateAll();
            return;
        }
    } catch (e) {
        console.error('Failed to load from URL:', e);
        alert(e.message);
    }

    // No URL hash - show welcome content
    const welcomeContent = `# Welcome to mdannotate

A markdown annotation tool using CriticMarkup syntax.

## How to use

1. **Open a file** using the button above, or drag & drop
2. **Select text** and click Highlight or Comment (or press ⌘E)
3. **Save changes** via Download or "Copy for Terminal"

## CriticMarkup syntax

Highlight text like this: {==important text==}

Add comments to highlights: {==highlighted==}{>>your note here<<}

---

*Delete this and start typing, or open a file to begin.*
`;
    initState(welcomeContent, 'document.md', false);
    setEditorContent(welcomeContent);
    updateTitle('mdannotate');
    showWelcome(false);
    updateAll();
}

// Expose functions to global scope for inline event handlers
window.mdannotate = {
    // Toolbar actions
    addHighlight: toolbarAddHighlight,
    addComment: openCommentModal,
    submitComment,
    closeModal,

    // Comment card actions
    jumpToAnnotation,
    editCommentAt,
    deleteAnnotationAt,
    clearAllAnnotations: clearAllAnnotationsAction,

    // Pane toggles
    toggleSource,
    togglePreview,
    toggleAnnotations,

    // Help
    showHelp,
    closeHelp,
    closeTerminalModal,

    // File operations
    openFile: openFilePicker,
    download: downloadFile,
    copyShareUrl,
    copyTerminal: copyTerminalCommand,

    // Save dropdown
    saveDefault,
    setSaveMode
};

// Start the app
init();
