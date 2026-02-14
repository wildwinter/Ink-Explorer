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

    private codeViewFollowEnabled = true;

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
        const buttons = document.querySelectorAll('.tab-button');
        const contents = document.querySelectorAll('.tab-content');

        buttons.forEach((button, index) => {
            const content = contents[index];
            if (!content) return;

            const isActive = content.id === `tab-${tabId}`;
            button.classList.toggle('active', isActive);
            content.classList.toggle('active', isActive);
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

    public showCodePaneEmpty(title: string, message: string): void {
        const pane = document.getElementById('code-pane');
        const titleEl = document.getElementById('code-pane-title');
        const sourceEl = document.getElementById('code-pane-source');
        if (!pane || !titleEl || !sourceEl) return;

        titleEl.textContent = title;
        sourceEl.innerHTML = `<span class="code-pane-prompt">${message}</span>`;
        pane.style.display = 'flex';
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

    public initCodeViewToolbar(): void {
        const followCheckbox = document.getElementById('code-view-follow') as HTMLInputElement | null;
        if (!followCheckbox) return;

        if (window.api && window.api.loadPref) {
            window.api.loadPref('codeViewFollow').then(val => {
                this.codeViewFollowEnabled = val === null ? true : val === 'true';
                if (followCheckbox) followCheckbox.checked = this.codeViewFollowEnabled;
            });
        } else {
            followCheckbox.checked = this.codeViewFollowEnabled;
        }

        followCheckbox.onchange = () => {
            this.codeViewFollowEnabled = followCheckbox.checked;
            if (window.api && window.api.savePref) {
                window.api.savePref('codeViewFollow', String(this.codeViewFollowEnabled));
            }
        };
    }

    public isCodeViewFollowEnabled(): boolean {
        return this.codeViewFollowEnabled;
    }
}
