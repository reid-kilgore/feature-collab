// UI interactions and event handlers

import { state, setContent, setSelection, clearSelection, setEditingIndex, setActiveComment, setUserHidAnnotations, setHadAnnotations, markSaved, getPositionInfo, getStats } from './editor.js';
import { getAnnotations, addHighlight, addCommentAnnotation, updateAnnotationComment, deleteAnnotation, clearAllAnnotations, generateSyntaxHighlight, escapeHtml, findTextInSource } from './annotations.js';
import { renderMarkdown } from './preview.js';
import { generateShareUrl, generateTerminalCommand } from './url.js';

// DOM elements (initialized in setup)
let editor, toolbar, commentsList, commentModal, commentInput, selectedPreview;
let helpModal, status, stats, position, lineNumbers, syntaxHighlight;
let previewPane, previewContent, previewToggle, commentCount, modalTitle, modalSubmit;
let clearAllBtn, sourcePane, sourceToggle, annotationsToggle, commentsPane, toast;
let fileInput, terminalModal, terminalCommand;
let saveDropdown, saveMenu;

let toastTimeout;

/**
 * Initialize UI with DOM elements
 */
export function initUI() {
    // Get all DOM elements
    editor = document.getElementById('editor');
    toolbar = document.getElementById('toolbar');
    commentsList = document.getElementById('commentsList');
    commentModal = document.getElementById('commentModal');
    commentInput = document.getElementById('commentInput');
    selectedPreview = document.getElementById('selectedPreview');
    helpModal = document.getElementById('helpModal');
    status = document.getElementById('status');
    stats = document.getElementById('stats');
    position = document.getElementById('position');
    lineNumbers = document.getElementById('lineNumbers');
    syntaxHighlight = document.getElementById('syntaxHighlight');
    previewPane = document.getElementById('previewPane');
    previewContent = document.getElementById('previewContent');
    previewToggle = document.getElementById('previewToggle');
    commentCount = document.getElementById('commentCount');
    modalTitle = document.getElementById('modalTitle');
    modalSubmit = document.getElementById('modalSubmit');
    clearAllBtn = document.getElementById('clearAllBtn');
    sourcePane = document.querySelector('.source-pane');
    sourceToggle = document.getElementById('sourceToggle');
    annotationsToggle = document.getElementById('annotationsToggle');
    commentsPane = document.querySelector('.comments-pane');
    toast = document.getElementById('toast');
    fileInput = document.getElementById('fileInput');
    terminalModal = document.getElementById('terminalModal');
    terminalCommand = document.getElementById('terminalCommand');
    saveDropdown = document.getElementById('saveDropdown');
    saveMenu = document.getElementById('saveMenu');

    setupEventListeners();
    setupSaveDropdown();
    loadDarkModePreference();
}

/**
 * Set up all event listeners
 */
function setupEventListeners() {
    // Editor events
    editor.addEventListener('mouseup', handleEditorSelection);
    editor.addEventListener('keyup', (e) => {
        if (e.shiftKey) handleEditorSelection();
        updatePositionDisplay();
    });
    editor.addEventListener('input', () => {
        setContent(editor.value);
        updateAll();
    });
    editor.addEventListener('scroll', () => {
        syntaxHighlight.scrollTop = editor.scrollTop;
        syntaxHighlight.scrollLeft = editor.scrollLeft;
        lineNumbers.style.transform = `translateY(-${editor.scrollTop}px)`;
    });
    editor.addEventListener('click', () => {
        updatePositionDisplay();
        toolbar.classList.remove('visible');
    });

    // Preview selection
    previewContent.addEventListener('mouseup', () => {
        setTimeout(handlePreviewSelection, 10);
    });

    // Global click to hide toolbar
    document.addEventListener('mousedown', (e) => {
        if (!toolbar.contains(e.target) && e.target !== editor && !previewContent.contains(e.target)) {
            toolbar.classList.remove('visible');
        }
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', handleKeyboardShortcuts);

    // Comment input
    commentInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            submitComment();
        }
    });

    // Unsaved changes warning
    window.addEventListener('beforeunload', (e) => {
        if (state.isModified) {
            e.preventDefault();
            e.returnValue = '';
        }
    });

    // File input
    fileInput.addEventListener('change', handleFileSelect);

    // Drag and drop
    document.body.addEventListener('dragover', (e) => {
        e.preventDefault();
        document.body.classList.add('drop-zone-active');
    });
    document.body.addEventListener('dragleave', (e) => {
        if (e.target === document.body || !document.body.contains(e.relatedTarget)) {
            document.body.classList.remove('drop-zone-active');
        }
    });
    document.body.addEventListener('drop', handleFileDrop);

    // Resizers
    initResizer(document.getElementById('previewResizer'), previewPane, 'left', handlePreviewResize);
    initResizer(document.getElementById('commentsResizer'), commentsPane, 'left', handleCommentsResize);
}

/**
 * Handle editor text selection
 */
function handleEditorSelection() {
    const start = editor.selectionStart;
    const end = editor.selectionEnd;

    if (start !== end) {
        const rect = editor.getBoundingClientRect();
        const text = editor.value.substring(0, end);
        const lines = text.split('\n');
        const lineHeight = 19.2;

        toolbar.style.top = Math.min(rect.top + lines.length * lineHeight + 20, rect.bottom - 40) + 'px';
        toolbar.style.left = (rect.left + 80) + 'px';
        toolbar.classList.add('visible');

        setSelection(start, end, false);
    } else {
        toolbar.classList.remove('visible');
    }
}

/**
 * Handle preview text selection
 */
function handlePreviewSelection() {
    const selection = window.getSelection();
    const selectedText = selection.toString().trim();

    if (selectedText && selectedText.length > 0) {
        const result = findTextInSource(editor.value, selectedText);

        if (result.found) {
            const range = selection.getRangeAt(0);
            const rect = range.getBoundingClientRect();

            toolbar.style.top = (rect.bottom + 5) + 'px';
            toolbar.style.left = rect.left + 'px';
            toolbar.classList.add('visible');

            setSelection(result.index, result.endIndex, true, selectedText, result.matchCount);
        } else {
            toolbar.classList.remove('visible');
            showToast('Text not found in source (may be transformed by markdown)');
        }
    } else {
        toolbar.classList.remove('visible');
    }
}

/**
 * Handle keyboard shortcuts
 */
function handleKeyboardShortcuts(e) {
    const isMod = e.metaKey || e.ctrlKey;

    if (e.key === 'Escape') {
        closeModal();
        closeHelp();
        toolbar.classList.remove('visible');
    }

    if (isMod && e.key === 's') {
        e.preventDefault();
        downloadFile();
    }

    if (isMod && e.key === 'e') {
        e.preventDefault();
        // Check for preview selection first
        const selection = window.getSelection();
        const selectedText = selection.toString().trim();
        if (selectedText && previewContent.contains(selection.anchorNode)) {
            handlePreviewSelection();
            if (state.pendingStart !== state.pendingEnd) {
                openCommentModal();
            }
        } else if (editor.selectionStart !== editor.selectionEnd) {
            setSelection(editor.selectionStart, editor.selectionEnd, false);
            openCommentModal();
        }
    }
}

/**
 * Set editor content and update display
 */
export function setEditorContent(content) {
    editor.value = content;
    updateAll();
}

/**
 * Update the document title/filename display
 */
export function updateTitle(filename, fromUrl = false) {
    const h1 = document.querySelector('.header h1');
    if (fromUrl) {
        h1.textContent = filename + ' (from URL)';
    } else {
        h1.textContent = filename;
    }
}

/**
 * Update all display elements
 */
export function updateAll() {
    updateLineNumbers();
    updateSyntaxHighlightDisplay();
    updateCommentsDisplay();
    updatePreviewDisplay();
    updateStatsDisplay();
    updatePositionDisplay();
}

function updateLineNumbers() {
    const lines = editor.value.split('\n');
    lineNumbers.innerHTML = lines.map((_, i) => `<div>${i + 1}</div>`).join('');
}

function updateSyntaxHighlightDisplay() {
    syntaxHighlight.innerHTML = generateSyntaxHighlight(editor.value);
}

function updatePreviewDisplay() {
    if (previewPane.classList.contains('collapsed')) return;
    previewContent.innerHTML = renderMarkdown(editor.value);
}

function updateStatsDisplay() {
    const annotations = getAnnotations(editor.value);
    const s = getStats(editor.value, annotations);
    stats.textContent = `${s.words} words · ${s.highlights} highlights · ${s.comments} comments`;
}

function updatePositionDisplay() {
    const pos = getPositionInfo(editor.value, editor.selectionStart);
    position.textContent = `Ln ${pos.line}, Col ${pos.column}`;
}

function updateCommentsDisplay() {
    const annotations = getAnnotations(editor.value);

    commentCount.textContent = annotations.length ? `(${annotations.length})` : '';
    clearAllBtn.style.display = annotations.length > 0 ? 'block' : 'none';

    if (annotations.length === 0) {
        commentsPane.classList.add('collapsed');
        commentsPane.style.width = '0';
        annotationsToggle.style.display = 'none';
        annotationsToggle.classList.remove('active');
        commentsList.innerHTML = '<div class="no-comments">No annotations yet.<br><br>Select text and press <kbd>⌘E</kbd> to add a comment.</div>';
        return;
    }

    // Show toggle button when there are annotations
    annotationsToggle.style.display = '';

    // Auto-show pane logic
    const isFirstAnnotation = !state.hadAnnotationsBefore;
    setHadAnnotations(true);

    if (commentsPane.classList.contains('collapsed') && (isFirstAnnotation || !state.userHidAnnotations)) {
        commentsPane.classList.remove('collapsed');
        commentsPane.style.width = '280px';
        annotationsToggle.classList.add('active');
    }

    if (!commentsPane.classList.contains('collapsed')) {
        annotationsToggle.classList.add('active');
    }

    commentsList.innerHTML = annotations.map((ann, i) => {
        return `
        <div class="comment-card ${state.activeCommentIndex === i ? 'active' : ''}"
             onclick="window.mdannotate.jumpToAnnotation(${i})">
            <button class="close-x" onclick="event.stopPropagation(); window.mdannotate.deleteAnnotationAt(${i})" title="Delete">×</button>
            <div class="highlight-text">${escapeHtml(ann.highlight)}</div>
            ${ann.comment ? `<div class="comment-text">${escapeHtml(ann.comment)}</div>` : '<div class="comment-text" style="color: var(--text-muted); font-style: italic;">No comment</div>'}
            <div class="card-actions">
                <button onclick="event.stopPropagation(); window.mdannotate.editCommentAt(${i})">${ann.comment ? 'Edit' : 'Add Comment'}</button>
            </div>
        </div>
    `}).join('');
}

// Toolbar actions
export function toolbarAddHighlight() {
    if (state.pendingStart === state.pendingEnd) return;

    const scrollTop = editor.scrollTop;
    const result = addHighlight(editor.value, state.pendingStart, state.pendingEnd);

    editor.value = result.text;
    setContent(result.text);
    toolbar.classList.remove('visible');
    updateAll();

    if (state.selectionFromPreview) {
        window.getSelection().removeAllRanges();
        if (state.pendingMatchCount > 1) {
            showToast(`${state.pendingMatchCount} matches found — annotated first occurrence`);
        }
    } else {
        editor.setSelectionRange(result.newCursorPos, result.newCursorPos);
        editor.focus();
        editor.scrollTop = scrollTop;
    }
}

export function openCommentModal() {
    if (state.pendingStart === state.pendingEnd) return;

    setEditingIndex(-1);
    modalTitle.textContent = 'Add Comment';
    modalSubmit.textContent = 'Add';

    const selected = editor.value.substring(state.pendingStart, state.pendingEnd);
    selectedPreview.textContent = selected.length > 150 ? selected.substring(0, 150) + '...' : selected;
    commentInput.value = '';
    commentModal.classList.add('visible');
    commentInput.focus();
    toolbar.classList.remove('visible');
}

export function editCommentAt(index) {
    const annotations = getAnnotations(editor.value);
    if (index < 0 || index >= annotations.length) return;

    const ann = annotations[index];
    setEditingIndex(index);
    setSelection(ann.index, ann.index + ann.fullMatch.length, false);

    modalTitle.textContent = 'Edit Comment';
    modalSubmit.textContent = 'Save';
    selectedPreview.textContent = ann.highlight.length > 150 ? ann.highlight.substring(0, 150) + '...' : ann.highlight;
    commentInput.value = ann.comment || '';
    commentModal.classList.add('visible');
    commentInput.focus();
}

export function submitComment() {
    const comment = commentInput.value.trim();
    if (!comment) {
        closeModal();
        return;
    }

    const scrollTop = editor.scrollTop;

    if (state.editingIndex >= 0) {
        const annotations = getAnnotations(editor.value);
        const ann = annotations[state.editingIndex];
        editor.value = updateAnnotationComment(editor.value, ann, comment);
    } else {
        const result = addCommentAnnotation(editor.value, state.pendingStart, state.pendingEnd, comment);
        editor.value = result.text;
    }

    setContent(editor.value);
    closeModal();
    updateAll();

    if (state.selectionFromPreview) {
        window.getSelection().removeAllRanges();
        if (state.pendingMatchCount > 1) {
            showToast(`${state.pendingMatchCount} matches found — annotated first occurrence`);
        }
    } else {
        editor.focus();
        editor.scrollTop = scrollTop;
    }
}

export function closeModal() {
    commentModal.classList.remove('visible');
    clearSelection();
    setEditingIndex(-1);
}

export function jumpToAnnotation(index) {
    const annotations = getAnnotations(editor.value);
    if (index < 0 || index >= annotations.length) return;

    const ann = annotations[index];
    setActiveComment(index);

    editor.focus();
    editor.setSelectionRange(ann.index, ann.index + ann.fullMatch.length);

    const linesBefore = editor.value.substring(0, ann.index).split('\n').length;
    const lineHeight = 19.2;
    editor.scrollTop = Math.max(0, (linesBefore - 5) * lineHeight);

    updateCommentsDisplay();
}

export function deleteAnnotationAt(index) {
    const annotations = getAnnotations(editor.value);
    if (index < 0 || index >= annotations.length) return;

    editor.value = deleteAnnotation(editor.value, annotations[index]);
    setContent(editor.value);
    updateAll();

    if (state.activeCommentIndex === index) {
        setActiveComment(-1);
    }
}

export function clearAllAnnotationsAction() {
    const annotations = getAnnotations(editor.value);
    if (annotations.length === 0) return;

    editor.value = clearAllAnnotations(editor.value);
    setContent(editor.value);
    setActiveComment(-1);
    updateAll();
}

// Pane toggles
export function toggleSource() {
    const isCollapsed = sourcePane.classList.contains('collapsed');
    if (isCollapsed) {
        sourcePane.classList.remove('collapsed');
        sourceToggle.classList.add('active');
    } else {
        sourcePane.classList.add('collapsed');
        sourceToggle.classList.remove('active');
    }
}

export function togglePreview() {
    const isCollapsed = previewPane.classList.contains('collapsed');
    if (isCollapsed) {
        previewPane.classList.remove('collapsed');
        previewPane.style.width = '';
        previewToggle.classList.add('active');
        updatePreviewDisplay();
    } else {
        previewPane.classList.add('collapsed');
        previewPane.style.width = '0';
        previewToggle.classList.remove('active');
    }
}

export function toggleAnnotations() {
    const isCollapsed = commentsPane.classList.contains('collapsed');
    if (isCollapsed) {
        commentsPane.classList.remove('collapsed');
        commentsPane.style.width = '280px';
        annotationsToggle.classList.add('active');
        setUserHidAnnotations(false);
    } else {
        commentsPane.classList.add('collapsed');
        commentsPane.style.width = '0';
        annotationsToggle.classList.remove('active');
        setUserHidAnnotations(true);
    }
}

export function toggleDarkMode() {
    document.body.classList.toggle('dark-mode');
    localStorage.setItem('mdannotate_darkmode', document.body.classList.contains('dark-mode'));
}

function loadDarkModePreference() {
    if (localStorage.getItem('mdannotate_darkmode') === 'true') {
        document.body.classList.add('dark-mode');
    }
}

// Help modal
export function showHelp() {
    helpModal.classList.add('visible');
}

export function closeHelp() {
    helpModal.classList.remove('visible');
}

// File operations
export function openFilePicker() {
    fileInput.click();
}

function handleFileSelect(e) {
    const file = e.target.files[0];
    if (!file) return;
    loadFile(file);
}

function handleFileDrop(e) {
    e.preventDefault();
    document.body.classList.remove('drop-zone-active');

    const file = e.dataTransfer.files[0];
    if (file && (file.name.endsWith('.md') || file.name.endsWith('.txt') || file.type === 'text/plain' || file.type === 'text/markdown')) {
        loadFile(file);
    }
}

function loadFile(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
        const content = e.target.result;
        // Strip header if present
        const cleanContent = content.replace(/^<!--\nANNOTATION FORMAT:[\s\S]*?-->\n\n?/, '');

        state.filename = file.name;
        state.loadedFromUrl = false;
        state.isModified = false;
        editor.value = cleanContent;
        setContent(cleanContent);

        updateTitle(file.name);
        updateAll();

        // Check if already has annotations
        if (getAnnotations(cleanContent).length > 0) {
            setHadAnnotations(true);
        }
    };
    reader.readAsText(file);
}

export function downloadFile() {
    saveMenu.classList.remove('visible');
    const content = editor.value;
    const header = `<!--
ANNOTATION FORMAT: CriticMarkup
- Highlights: {==highlighted text==}
- Comments: {>>comment text<<}
- Combined: {==highlight==}{>>comment<<}
Learn more: https://criticmarkup.com
-->

`;
    const fullContent = header + content;

    const blob = new Blob([fullContent], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = state.filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    markSaved();
    status.textContent = 'Downloaded';
    status.classList.remove('status-modified');
    status.classList.add('status-saved');
}

function handleDownloadDrag(e) {
    const content = editor.value;
    const header = `<!--
ANNOTATION FORMAT: CriticMarkup
- Highlights: {==highlighted text==}
- Comments: {>>comment text<<}
- Combined: {==highlight==}{>>comment<<}
Learn more: https://criticmarkup.com
-->

`;
    const fullContent = header + content;
    const dataUrl = 'data:text/markdown;base64,' + btoa(unescape(encodeURIComponent(fullContent)));

    e.dataTransfer.setData('DownloadURL', `text/markdown:${state.filename}:${dataUrl}`);
    e.dataTransfer.setData('text/plain', fullContent);
    e.dataTransfer.effectAllowed = 'copy';
}

export async function copyShareUrl() {
    saveMenu.classList.remove('visible');
    try {
        const { url, size } = await generateShareUrl(editor.value, state.filename);

        if (size > 32000) {
            alert(`Warning: URL is ${size} characters. Very large URLs may not work in all browsers or when shared.`);
        }

        await navigator.clipboard.writeText(url);

        status.textContent = `URL copied (${size} chars)`;
        status.classList.remove('status-modified');
        status.classList.add('status-saved');

        setTimeout(() => {
            if (state.isModified) {
                status.textContent = 'Modified';
                status.classList.add('status-modified');
                status.classList.remove('status-saved');
            } else {
                status.textContent = 'Ready';
                status.classList.remove('status-modified', 'status-saved');
            }
        }, 3000);
    } catch (e) {
        console.error('Failed to create share URL:', e);
        alert('Failed to create shareable URL: ' + e.message);
    }
}

export async function copyTerminalCommand() {
    saveMenu.classList.remove('visible');
    try {
        const { command, size } = await generateTerminalCommand(editor.value, state.filename);

        await navigator.clipboard.writeText(command);

        // Show the terminal modal with the command
        terminalCommand.textContent = command;
        terminalModal.classList.add('visible');

        if (size > 32000) {
            showToast('Warning: Document is large. Command may be too long for some terminals.');
        }
    } catch (e) {
        console.error('Failed to create terminal command:', e);
        alert('Failed to create terminal command: ' + e.message);
    }
}

export function closeTerminalModal() {
    terminalModal.classList.remove('visible');
}

// Save dropdown
function setupSaveDropdown() {
    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
        if (!saveDropdown.contains(e.target)) {
            saveMenu.classList.remove('visible');
        }
    });
}

export function toggleSaveMenu(e) {
    if (e) e.stopPropagation();
    saveMenu.classList.toggle('visible');
}

// Toast notifications
export function showToast(message, duration = 3000) {
    toast.textContent = message;
    toast.classList.add('visible');
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => {
        toast.classList.remove('visible');
    }, duration);
}

// Resizer functionality
function initResizer(resizer, targetPane, direction, onResize) {
    let startX, startWidth;

    resizer.addEventListener('mousedown', (e) => {
        startX = e.clientX;
        startWidth = targetPane.offsetWidth;
        resizer.classList.add('dragging');
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    });

    function onMouseMove(e) {
        const diff = direction === 'left' ? (startX - e.clientX) : (e.clientX - startX);
        const newWidth = Math.max(0, Math.min(800, startWidth + diff));
        targetPane.style.width = newWidth + 'px';
        if (onResize) onResize(newWidth);
    }

    function onMouseUp() {
        resizer.classList.remove('dragging');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
    }
}

function handlePreviewResize(width) {
    if (width < 50) {
        previewToggle.classList.remove('active');
        previewPane.classList.add('collapsed');
        previewPane.style.width = '0';
    } else {
        previewToggle.classList.add('active');
        previewPane.classList.remove('collapsed');
        updatePreviewDisplay();
    }
}

function handleCommentsResize(width) {
    if (width < 50) {
        annotationsToggle.classList.remove('active');
        commentsPane.classList.add('collapsed');
    } else {
        annotationsToggle.classList.add('active');
        commentsPane.classList.remove('collapsed');
    }
}

// Update status display
export function updateStatus(text, type = 'normal') {
    status.textContent = text;
    status.classList.remove('status-modified', 'status-saved');
    if (type === 'modified') {
        status.classList.add('status-modified');
    } else if (type === 'saved') {
        status.classList.add('status-saved');
    }
}
