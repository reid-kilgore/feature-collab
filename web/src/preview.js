// Markdown preview rendering

import { escapeHtml } from './annotations.js';

// SVG icon for heading anchors (GitHub-style link icon)
const ANCHOR_ICON = `<svg class="anchor-icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M7.775 3.275a.75.75 0 001.06 1.06l1.25-1.25a2 2 0 112.83 2.83l-2.5 2.5a2 2 0 01-2.83 0 .75.75 0 00-1.06 1.06 3.5 3.5 0 004.95 0l2.5-2.5a3.5 3.5 0 00-4.95-4.95l-1.25 1.25zm-.5 9.5a.75.75 0 00-1.06-1.06l-1.25 1.25a2 2 0 11-2.83-2.83l2.5-2.5a2 2 0 012.83 0 .75.75 0 001.06-1.06 3.5 3.5 0 00-4.95 0l-2.5 2.5a3.5 3.5 0 004.95 4.95l1.25-1.25z"/></svg>`;

/**
 * Generate a URL-safe slug from heading text
 */
function generateSlug(text) {
    return text.toLowerCase().trim()
        .replace(/<[^>]*>/g, '')      // Strip HTML tags
        .replace(/[^\w\s-]/g, '')     // Remove special chars
        .replace(/\s+/g, '-')         // Spaces to hyphens
        .replace(/-+/g, '-')          // Collapse multiple hyphens
        .replace(/^-|-$/g, '');       // Trim leading/trailing hyphens
}

/**
 * Render markdown content to HTML
 */
export function renderMarkdown(md) {
    // Render CriticMarkup as visual highlights
    md = md.replace(/\{==([^=]*)==\}\{>>([^<]*)<<\}/g, (match, text, comment) => {
        return `<span class="preview-highlight has-comment" title="${escapeHtml(comment)}">${escapeHtml(text)}</span><span class="preview-comment-marker">${escapeHtml(comment.substring(0, 20))}${comment.length > 20 ? '...' : ''}</span>`;
    });

    md = md.replace(/\{==([^=]*)==\}/g, '<span class="preview-highlight">$1</span>');

    // Fenced code blocks (must be done early, before other processing)
    md = md.replace(/```(\w*)\n([\s\S]*?)```/g, (match, lang, code) => {
        return '<pre><code class="language-' + (lang || 'text') + '">' + highlightCode(code.trim(), lang) + '</code></pre>';
    });

    // Tables
    md = md.replace(/^(\|.+\|)\n(\|[-:\| ]+\|)\n((?:\|.+\|\n?)+)/gm, (match, header, separator, body) => {
        const headerCells = header.split('|').slice(1, -1).map(c => '<th>' + c.trim() + '</th>').join('');
        const bodyRows = body.trim().split('\n').map(row => {
            const cells = row.split('|').slice(1, -1).map(c => '<td>' + c.trim() + '</td>').join('');
            return '<tr>' + cells + '</tr>';
        }).join('');
        return '<table><thead><tr>' + headerCells + '</tr></thead><tbody>' + bodyRows + '</tbody></table>';
    });

    // Headings with anchor links
    const slugCounts = {};
    function createHeading(level, text) {
        let slug = generateSlug(text) || 'heading';
        if (slugCounts[slug] !== undefined) {
            slug = `${slug}-${++slugCounts[slug]}`;
        } else {
            slugCounts[slug] = 0;
        }
        return `<h${level} id="${slug}"><a class="heading-anchor" href="#${slug}">${ANCHOR_ICON}</a>${text}</h${level}>`;
    }

    md = md.replace(/^### (.*)$/gm, (_, t) => createHeading(3, t));
    md = md.replace(/^## (.*)$/gm, (_, t) => createHeading(2, t));
    md = md.replace(/^# (.*)$/gm, (_, t) => createHeading(1, t));
    md = md.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    md = md.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    md = md.replace(/`([^`]+)`/g, '<code>$1</code>');
    md = md.replace(/^---+$/gm, '<hr>');
    md = md.replace(/^>\s+(.*)$/gm, '<blockquote>$1</blockquote>');

    // Handle lists with proper nesting
    const lines = md.split('\n');
    let result = [];
    let listStack = []; // Track nested list levels

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const listMatch = line.match(/^(\s*)([-*]|\d+\.)\s+(.*)$/);

        if (listMatch) {
            const indent = listMatch[1].length;
            let content = listMatch[3];
            const level = Math.floor(indent / 2);

            // Close lists that are deeper than current
            while (listStack.length > level + 1) {
                result.push('</ul>');
                listStack.pop();
            }

            // Open new lists if needed
            while (listStack.length < level + 1) {
                result.push('<ul>');
                listStack.push(level);
            }

            // Check for task list checkbox
            const checkboxMatch = content.match(/^\[([ xX])\]\s+(.*)$/);
            if (checkboxMatch) {
                const checked = checkboxMatch[1].toLowerCase() === 'x';
                const text = checkboxMatch[2];
                const checkbox = checked
                    ? '<input type="checkbox" class="checkbox" checked disabled>'
                    : '<input type="checkbox" class="checkbox" disabled>';
                result.push('<li class="task-item">' + checkbox + text + '</li>');
            } else {
                result.push('<li>' + content + '</li>');
            }
        } else {
            // Close all open lists
            while (listStack.length > 0) {
                result.push('</ul>');
                listStack.pop();
            }
            result.push(line);
        }
    }

    // Close any remaining lists
    while (listStack.length > 0) {
        result.push('</ul>');
        listStack.pop();
    }

    md = result.join('\n');

    // Paragraphs (skip elements that shouldn't be wrapped)
    md = md.split('\n\n').map(para => {
        para = para.trim();
        if (!para) return '';
        if (para.match(/^<(h[1-6]|ul|ol|li|pre|hr|blockquote|table|\/)/)) return para;
        return `<p>${para.replace(/\n/g, '<br>')}</p>`;
    }).join('\n');

    return md;
}

/**
 * Highlight code with basic syntax coloring
 */
function highlightCode(code, lang) {
    let html = escapeHtml(code);

    // Extract comments and strings first to protect them from other regexes
    const protectedTokens = [];
    const protect = (match) => {
        const id = `__PROTECTED_${protectedTokens.length}__`;
        protectedTokens.push(match);
        return id;
    };

    // Protect comments
    html = html.replace(/(\/\/.*$)/gm, (m) => protect('<span class="comment">' + m + '</span>'));
    html = html.replace(/(\/\*[\s\S]*?\*\/)/g, (m) => protect('<span class="comment">' + m + '</span>'));

    // Protect strings
    html = html.replace(/(&quot;[^&]*&quot;)/g, (m) => protect('<span class="string">' + m + '</span>'));
    html = html.replace(/('(?:[^'\\]|\\.)*')/g, (m) => protect('<span class="string">' + m + '</span>'));
    html = html.replace(/(`(?:[^`\\]|\\.)*`)/g, (m) => protect('<span class="string">' + m + '</span>'));

    // Keywords
    const keywords = /\b(const|let|var|function|return|if|else|for|while|do|switch|case|break|continue|try|catch|throw|finally|new|delete|typeof|instanceof|in|of|class|extends|import|export|from|default|async|await|yield|static|get|set|interface|type|enum|implements|public|private|protectedTokens|readonly|abstract|declare|namespace|module)\b/g;
    html = html.replace(keywords, '<span class="keyword">$1</span>');

    // Types (TypeScript/Flow)
    const types = /\b(string|number|boolean|void|null|undefined|any|never|unknown|object|symbol|bigint|Array|Object|Function|Promise|Map|Set|Date|RegExp|Error)\b/g;
    html = html.replace(types, '<span class="type">$1</span>');

    // Numbers
    html = html.replace(/\b(\d+\.?\d*)\b/g, '<span class="number">$1</span>');

    // Property names (before colon)
    html = html.replace(/(\w+)(?=\s*:)/g, '<span class="property">$1</span>');

    // Restore protectedTokens content
    for (let i = 0; i < protectedTokens.length; i++) {
        html = html.replace(`__PROTECTED_${i}__`, protectedTokens[i]);
    }

    return html;
}
