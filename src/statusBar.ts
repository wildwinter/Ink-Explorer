/**
 * Status Bar
 * Shows the loaded file path (left) and temporary status messages (right).
 */

let hideTimeout: ReturnType<typeof setTimeout> | null = null;

export function showStatus(message: string, durationMs = 4000): void {
    const el = document.getElementById('status-bar-message');
    if (!el) return;

    el.textContent = message;
    el.classList.add('visible');

    if (hideTimeout) clearTimeout(hideTimeout);
    hideTimeout = setTimeout(() => {
        el.classList.remove('visible');
    }, durationMs);
}

export function setStatusFile(filePath: string | null): void {
    const el = document.getElementById('status-bar-file');
    if (!el) return;
    el.textContent = filePath || '';
}
