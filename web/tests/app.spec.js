import { test, expect } from '@playwright/test';

test.describe('mdannotate', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
    });

    test('shows welcome content on load', async ({ page }) => {
        // Check editor has welcome content
        const editor = page.locator('#editor');
        await expect(editor).toHaveValue(/Welcome to mdannotate/);
        await expect(editor).toHaveValue(/CriticMarkup syntax/);

        // Check preview renders
        const preview = page.locator('#previewContent');
        await expect(preview).toContainText('Welcome to mdannotate');
    });

    test('shows annotations from welcome content', async ({ page }) => {
        // Welcome content has 2 example annotations
        const annotationCards = page.locator('.comment-card');
        await expect(annotationCards).toHaveCount(2);

        // Check annotation content
        await expect(page.locator('.comment-card').first()).toContainText('important text');
    });

    test('save dropdown opens and has all options', async ({ page }) => {
        // Click the Save button to open dropdown
        await page.locator('#saveBtn').click();

        // Dropdown should be visible
        const dropdown = page.locator('#saveMenu');
        await expect(dropdown).toBeVisible();

        // Check all options exist
        await expect(dropdown.locator('[data-action="shareUrl"]')).toContainText('Share URL');
        await expect(dropdown.locator('[data-action="terminal"]')).toContainText('Copy for CLI');
        await expect(dropdown.locator('[data-action="download"]')).toContainText('Download');
    });

    test('save dropdown closes when clicking outside', async ({ page }) => {
        // Open dropdown
        await page.locator('#saveBtn').click();
        const dropdown = page.locator('#saveMenu');
        await expect(dropdown).toBeVisible();

        // Click outside
        await page.locator('.source-pane').click();
        await expect(dropdown).not.toBeVisible();
    });

    test('can add highlight to text', async ({ page }) => {
        // Clear editor and add test content
        const editor = page.locator('#editor');
        await editor.fill('This is test content to highlight.');

        // Select "test content"
        await editor.focus();
        await page.evaluate(() => {
            const editor = document.getElementById('editor');
            editor.setSelectionRange(8, 20); // "test content"
        });

        // Trigger selection event
        await editor.dispatchEvent('mouseup');

        // Toolbar should appear
        const toolbar = page.locator('#toolbar');
        await expect(toolbar).toBeVisible();

        // Click highlight
        await toolbar.locator('button', { hasText: 'Highlight' }).click();

        // Check editor now has highlight markup
        await expect(editor).toHaveValue(/\{==test content==\}/);
    });

    test('source toggle hides/shows source pane', async ({ page }) => {
        const sourcePane = page.locator('.source-pane');
        const sourceToggle = page.locator('#sourceToggle');

        // Initially visible
        await expect(sourcePane).not.toHaveClass(/collapsed/);

        // Click to hide
        await sourceToggle.click();
        await expect(sourcePane).toHaveClass(/collapsed/);

        // Click to show
        await sourceToggle.click();
        await expect(sourcePane).not.toHaveClass(/collapsed/);
    });

    test('preview toggle hides/shows preview pane', async ({ page }) => {
        const previewPane = page.locator('#previewPane');
        const previewToggle = page.locator('#previewToggle');

        // Initially visible
        await expect(previewPane).not.toHaveClass(/collapsed/);

        // Click to hide
        await previewToggle.click();
        await expect(previewPane).toHaveClass(/collapsed/);

        // Click to show
        await previewToggle.click();
        await expect(previewPane).not.toHaveClass(/collapsed/);
    });

    test('help modal opens and closes', async ({ page }) => {
        const helpModal = page.locator('#helpModal');

        // Click help button
        await page.locator('button', { hasText: 'Help' }).click();
        await expect(helpModal).toHaveClass(/visible/);

        // Close with Done button
        await helpModal.locator('button', { hasText: 'Done' }).click();
        await expect(helpModal).not.toHaveClass(/visible/);
    });

    test('clicking annotation card jumps to source', async ({ page }) => {
        // Click first annotation card
        await page.locator('.comment-card').first().click();

        // Editor should have selection at that annotation
        const selectionStart = await page.evaluate(() => {
            return document.getElementById('editor').selectionStart;
        });

        // Should have moved selection (not at 0)
        expect(selectionStart).toBeGreaterThan(0);
    });
});
