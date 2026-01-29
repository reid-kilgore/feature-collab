// URL encoding/decoding for document sharing

const HEADER_COMMENT = `<!--
ANNOTATION FORMAT: CriticMarkup
- Highlights: {==highlighted text==}
- Comments: {>>comment text<<}
- Combined: {==highlight==}{>>comment<<}
Learn more: https://criticmarkup.com
-->

`;

/**
 * Strip the CriticMarkup header comment from content
 */
export function stripHeader(content) {
    return content.replace(/^<!--\nANNOTATION FORMAT:[\s\S]*?-->\n\n?/, '');
}

/**
 * Add the CriticMarkup header comment to content
 */
export function addHeader(content) {
    return HEADER_COMMENT + content;
}

/**
 * Load document from URL hash (#doc=...)
 * Returns { content, filename } or null if no hash
 */
export async function loadFromHash() {
    const hash = window.location.hash;
    if (!hash.startsWith('#doc=')) {
        return null;
    }

    // Check for filename parameter
    let filename = 'document.md';
    const hashContent = hash.substring(1); // Remove #
    const params = new URLSearchParams(hashContent.includes('&') ? hashContent : '');

    // Parse hash format: #doc=<encoded>&name=<filename>
    let encoded;
    if (hashContent.includes('&')) {
        const parts = hashContent.split('&');
        for (const part of parts) {
            if (part.startsWith('doc=')) {
                encoded = part.substring(4);
            } else if (part.startsWith('name=')) {
                filename = decodeURIComponent(part.substring(5));
            }
        }
    } else {
        encoded = hash.substring(5); // Just #doc=<encoded>
    }

    if (!encoded) {
        return null;
    }

    try {
        // Add padding if needed
        let padded = encoded;
        const padding = 4 - (encoded.length % 4);
        if (padding !== 4) {
            padded += '='.repeat(padding);
        }

        // Convert URL-safe base64 to regular base64
        const base64 = padded.replace(/-/g, '+').replace(/_/g, '/');
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }

        // Decompress using DecompressionStream
        const ds = new DecompressionStream('gzip');
        const decompressed = new Response(
            new Blob([bytes]).stream().pipeThrough(ds)
        );
        const text = await decompressed.text();
        const content = stripHeader(text);

        return { content, filename };
    } catch (e) {
        console.error('Failed to load from URL hash:', e);
        throw new Error('Failed to load document from URL: ' + e.message);
    }
}

/**
 * Compress content and generate URL-safe encoded string
 * Returns { encoded, size }
 */
export async function compressContent(content) {
    const fullContent = addHeader(content);

    const encoder = new TextEncoder();
    const data = encoder.encode(fullContent);
    const cs = new CompressionStream('gzip');
    const writer = cs.writable.getWriter();
    writer.write(data);
    writer.close();

    const compressed = await new Response(cs.readable).arrayBuffer();
    const bytes = new Uint8Array(compressed);

    // Convert to URL-safe base64
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    const base64 = btoa(binary);
    const urlSafe = base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

    return { encoded: urlSafe, size: urlSafe.length };
}

/**
 * Generate a shareable URL with the document encoded in the hash
 */
export async function generateShareUrl(content, filename = null) {
    const { encoded, size } = await compressContent(content);

    let hash = '#doc=' + encoded;
    if (filename && filename !== 'document.md') {
        hash += '&name=' + encodeURIComponent(filename);
    }

    const fullUrl = window.location.origin + window.location.pathname + hash;

    return { url: fullUrl, size };
}

/**
 * Update the URL hash with the current document content (debounced).
 * Allows copying the URL from the address bar at any time.
 */
let _syncTimeout = null;
export function syncUrlHash(content, filename = null, delay = 500) {
    clearTimeout(_syncTimeout);
    _syncTimeout = setTimeout(async () => {
        try {
            const { encoded } = await compressContent(content);
            let hash = '#doc=' + encoded;
            if (filename && filename !== 'document.md') {
                hash += '&name=' + encodeURIComponent(filename);
            }
            history.replaceState(null, '', hash);
        } catch (e) {
            // Silently fail — not critical
        }
    }, delay);
}

/**
 * Generate a terminal command to decode the document
 */
export async function generateTerminalCommand(content, filename = 'document.md') {
    const { encoded, size } = await compressContent(content);

    // Generate the decode command
    const command = `mdannotate --decode ${encoded} > "${filename}"`;

    return { command, size };
}
