/**
 * UI Manager
 * Handles tabs, code pane, and theme
 */

import { highlightInkSyntax } from './syntaxHighlighter.js';

export interface Tab {
    id: string;
    label: string;
    content: string;
    type: 'html' | 'text';
}

export class UIManager {

    constructor() {
        this.setupEventListeners();
    }

    private setupEventListeners() {
        // Set up close button for code pane
        const closeBtn = document.getElementById('code-pane-close');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => this.hideCodePane());
        }
    }

    public applyTheme(theme: 'light' | 'dark'): void {
        document.documentElement.setAttribute('data-theme', theme);
    }

    /**
     * Creates tabs for the right pane
     */
    public createTabs(tabs: Tab[]) {
        const tabButtonsContainer = document.getElementById('tab-buttons');
        const tabsContentContainer = document.getElementById('tabs-content');

        if (!tabButtonsContainer || !tabsContentContainer) {
            console.error('Tab containers not found');
            return;
        }

        // Clear existing tabs
        tabButtonsContainer.innerHTML = '';
        tabsContentContainer.innerHTML = '';

        // Create tab buttons and content
        tabs.forEach((tab, index) => {
            // Create button
            const button = document.createElement('button');
            button.className = `tab-button${index === 0 ? ' active' : ''}`;
            button.textContent = tab.label;
            button.onclick = () => this.switchTab(tab.id);
            tabButtonsContainer.appendChild(button);

            // Create content
            const content = document.createElement('div');
            content.className = `tab-content${index === 0 ? ' active' : ''}`;
            content.id = `tab-${tab.id}`;

            if (tab.type === 'html') {
                content.innerHTML = tab.content;
            } else {
                const pre = document.createElement('pre');
                pre.textContent = tab.content;
                content.appendChild(pre);
            }

            tabsContentContainer.appendChild(content);
        });
    }

    /**
     * Switches to a specific tab
     */
    public switchTab(tabId: string) {
        // Update button states
        const buttons = document.querySelectorAll('.tab-button');
        buttons.forEach((button, index) => {
            const content = document.querySelectorAll('.tab-content')[index];
            if (!content) return;

            const contentId = content.id.replace('tab-', '');

            if (button.textContent === tabId || contentId === tabId) { // simplified check logic
                button.classList.add('active');
                content.classList.add('active');
            } else {
                button.classList.remove('active');
                content.classList.remove('active');
            }
        });

        // Also explicitly match by ID if previous loop didn't catch it correctly (robustness)
        const contents = document.querySelectorAll('.tab-content');
        contents.forEach(content => {
            if (content.id === `tab-${tabId}`) {
                content.classList.add('active');
                // Find corresponding button
                // This implies strict ordering, which createTabs enforces.
            } else {
                content.classList.remove('active');
            }
        });

        // Fix button active state based on content active state
        buttons.forEach((button, index) => {
            const content = contents[index];
            if (content && content.classList.contains('active')) {
                button.classList.add('active');
            } else {
                button.classList.remove('active');
            }
        });
    }

    public showCodePane(title: string, source: string): void {
        const pane = document.getElementById('code-pane');
        const titleEl = document.getElementById('code-pane-title');
        const sourceEl = document.getElementById('code-pane-source');
        if (!pane || !titleEl || !sourceEl) return;

        titleEl.textContent = title;
        sourceEl.innerHTML = highlightInkSyntax(source);
        pane.style.display = 'flex';
    }

    public hideCodePane(): void {
        const pane = document.getElementById('code-pane');
        if (pane) pane.style.display = 'none';
        // Caller handles saving state
    }

    public showCodePanePrompt(): void {
        const pane = document.getElementById('code-pane');
        const titleEl = document.getElementById('code-pane-title');
        const sourceEl = document.getElementById('code-pane-source');
        if (!pane || !titleEl || !sourceEl) return;

        titleEl.textContent = 'Ink Source';
        sourceEl.innerHTML = '<span class="code-pane-prompt">Click on a node to view the code</span>';
        pane.style.display = 'flex';
    }

    public toggleCodePane(): void {
        const pane = document.getElementById('code-pane');
        if (!pane) return;
        if (pane.style.display === 'none') {
            pane.style.display = 'flex';
        } else {
            pane.style.display = 'none';
        }
    }

    public isCodePaneOpen(): boolean {
        const pane = document.getElementById('code-pane');
        return pane ? pane.style.display !== 'none' : false;
    }
}
