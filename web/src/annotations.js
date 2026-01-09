// CriticMarkup annotation parsing and manipulation

/**
 * Parse all annotations from the editor content
 * Returns array of { highlight, comment, index, fullMatch }
 */
export function getAnnotations(text) {
    const annotations = [];
    const regex = /\{==([^=]*)==\}(?:\{>>([^<]*)<<\})?/g;
    let match;

    while ((match = regex.exec(text)) !== null) {
        annotations.push({
            highlight: match[1],
            comment: match[2] || null,
            index: match.index,
            fullMatch: match[0]
        });
    }

    return annotations;
}

/**
 * Add a highlight annotation (no comment)
 */
export function addHighlight(text, start, end) {
    const selected = text.substring(start, end);
    const before = text.substring(0, start);
    const after = text.substring(end);

    return {
        text: before + '{==' + selected + '==}' + after,
        newCursorPos: start + selected.length + 8 // After ==}
    };
}

/**
 * Add a highlight with comment
 */
export function addCommentAnnotation(text, start, end, comment) {
    const selected = text.substring(start, end);
    const before = text.substring(0, start);
    const after = text.substring(end);

    return {
        text: before + '{==' + selected + '==}{>>' + comment + '<<}' + after,
        newCursorPos: start + selected.length + comment.length + 14 // After <<}
    };
}

/**
 * Update an existing annotation's comment
 */
export function updateAnnotationComment(text, annotation, newComment) {
    const newMarkup = '{==' + annotation.highlight + '==}{>>' + newComment + '<<}';
    return text.substring(0, annotation.index) + newMarkup + text.substring(annotation.index + annotation.fullMatch.length);
}

/**
 * Delete an annotation, keeping just the highlighted text
 */
export function deleteAnnotation(text, annotation) {
    return text.substring(0, annotation.index) + annotation.highlight + text.substring(annotation.index + annotation.fullMatch.length);
}

/**
 * Clear all annotations, keeping only the original text
 */
export function clearAllAnnotations(text) {
    const annotations = getAnnotations(text);

    // Work backwards to preserve indices
    let result = text;
    for (let i = annotations.length - 1; i >= 0; i--) {
        const ann = annotations[i];
        result = result.substring(0, ann.index) + ann.highlight + result.substring(ann.index + ann.fullMatch.length);
    }

    return result;
}

/**
 * Generate syntax highlighting HTML for the editor overlay
 */
export function generateSyntaxHighlight(text) {
    let html = escapeHtml(text);

    // Highlight CriticMarkup syntax - full annotations with comments
    html = html.replace(/(\{==)([\s\S]*?)(==\})(\{&gt;&gt;)([\s\S]*?)(&lt;&lt;\})/g,
        '<span class="bracket">$1</span><span class="hl">$2</span><span class="bracket">$3$4</span><span class="cm">$5</span><span class="bracket">$6</span>');

    // Highlight-only annotations
    html = html.replace(/(\{==)([\s\S]*?)(==\})(?!\{&gt;&gt;)/g,
        '<span class="bracket">$1</span><span class="hl">$2</span><span class="bracket">$3</span>');

    return html + '\n';
}

/**
 * Escape HTML special characters
 */
export function escapeHtml(text) {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Find text in source and return match info
 * Used when selecting text in preview to annotate
 */
export function findTextInSource(sourceText, selectedText) {
    const index = sourceText.indexOf(selectedText);

    if (index === -1) {
        return { found: false };
    }

    // Count occurrences
    let count = 0;
    let searchIndex = 0;
    while ((searchIndex = sourceText.indexOf(selectedText, searchIndex)) !== -1) {
        count++;
        searchIndex += selectedText.length;
    }

    return {
        found: true,
        index,
        endIndex: index + selectedText.length,
        matchCount: count
    };
}
