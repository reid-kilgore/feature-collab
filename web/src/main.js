// Main entry point for mdannotate web app

import '../styles/main.css';
import { initState, state, setHadAnnotations } from './editor.js';
import { loadFromHash, stripHeader } from './url.js';
import { getAnnotations } from './annotations.js';
import {
    initUI, setEditorContent, showWelcome, updateTitle, updateAll,
    toolbarAddHighlight, openCommentModal, submitComment, closeModal,
    jumpToAnnotation, editCommentAt, deleteAnnotationAt, clearAllAnnotationsAction,
    toggleSource, togglePreview, toggleAnnotations, toggleDarkMode,
    showHelp, closeHelp, openFilePicker, downloadFile, copyShareUrl, copyTerminalCommand
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

    // No URL hash - show welcome screen
    initState('', 'document.md', false);
    setEditorContent('');
    updateTitle('mdannotate');
    showWelcome(true);
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
    toggleDarkMode,

    // Help
    showHelp,
    closeHelp,

    // File operations
    openFile: openFilePicker,
    download: downloadFile,
    copyShareUrl,
    copyTerminal: copyTerminalCommand
};

// Start the app
init();
