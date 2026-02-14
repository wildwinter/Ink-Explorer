/**
 * States Controller
 * Manages saving, loading, and deleting ink story states as .inkstate files
 */

import type { Story } from 'inkjs';

export const STATES_HTML = `
<div class="states-container">
  <div class="states-toolbar">
    <input type="text" class="states-name-input" id="states-name-input" placeholder="State name..." />
    <div class="live-ink-btn" id="states-save-btn" title="Save current state">
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
        <polyline points="17 21 17 13 7 13 7 21"/>
        <polyline points="7 3 7 8 15 8"/>
      </svg>
      <span>Save</span>
    </div>
  </div>
  <div class="states-list" id="states-list">
    <div class="live-ink-prompt" id="states-empty">No saved states.</div>
  </div>
</div>`;

export class StatesController {

    private currentStory: InstanceType<typeof Story> | null = null;
    private inkFilePath: string | null = null;
    private stateNames: string[] = [];
    private autoLoadStateName: string | null = null;
    private onStateLoaded: ((story: InstanceType<typeof Story>) => void) | null = null;

    public init() {
        // Sync the save button/input state with whether a story is running
        this.updateSaveButtonState();
    }

    public setOnStateLoaded(callback: ((story: InstanceType<typeof Story>) => void) | null) {
        this.onStateLoaded = callback;
    }

    public setStory(story: InstanceType<typeof Story> | null) {
        this.currentStory = story;
        this.updateSaveButtonState();
    }

    public async setInkFilePath(filePath: string | null) {
        this.inkFilePath = filePath;
        if (filePath) {
            await this.refreshList();
            await this.loadAutoLoadPref();
        } else {
            this.stateNames = [];
            this.autoLoadStateName = null;
            this.renderList();
        }
    }

    public clear() {
        this.currentStory = null;
        this.stateNames = [];
        this.updateSaveButtonState();
        this.renderList();
    }

    /**
     * Returns the JSON string of the auto-load state, or null if none is set.
     */
    public async getAutoLoadStateJson(): Promise<string | null> {
        if (!this.autoLoadStateName || !this.inkFilePath) return null;
        if (!this.stateNames.includes(this.autoLoadStateName)) return null;
        try {
            return await window.api.loadInkState(this.inkFilePath, this.autoLoadStateName);
        } catch {
            return null;
        }
    }

    public setupEventListeners() {
        document.addEventListener('keydown', (e) => {
            const target = e.target as HTMLElement;
            if (e.key === 'Enter' && target.id === 'states-name-input') {
                e.preventDefault();
                this.handleSave();
            }
        });

        document.addEventListener('click', (e) => {
            const target = e.target as HTMLElement;

            if (target.closest('#states-save-btn')) {
                e.preventDefault();
                this.handleSave();
                return;
            }

            const loadBtn = target.closest('.states-load-btn') as HTMLElement | null;
            if (loadBtn) {
                e.preventDefault();
                const name = loadBtn.dataset.name;
                if (name) this.handleLoad(name);
                return;
            }

            const deleteBtn = target.closest('.states-delete-btn') as HTMLElement | null;
            if (deleteBtn) {
                e.preventDefault();
                const name = deleteBtn.dataset.name;
                if (name) this.handleDelete(name);
                return;
            }

            const autoloadBtn = target.closest('.states-autoload-btn') as HTMLElement | null;
            if (autoloadBtn) {
                e.preventDefault();
                const name = autoloadBtn.dataset.name;
                if (name) this.handleToggleAutoLoad(name);
                return;
            }
        });
    }

    private async handleSave() {
        if (!this.currentStory || !this.inkFilePath) return;

        const input = document.getElementById('states-name-input') as HTMLInputElement | null;
        if (!input) return;

        const name = input.value.trim();
        if (!name) {
            input.classList.add('invalid');
            setTimeout(() => input.classList.remove('invalid'), 400);
            return;
        }

        // Validate filename (no path separators or special chars)
        if (/[/\\:*?"<>|]/.test(name)) {
            input.classList.add('invalid');
            setTimeout(() => input.classList.remove('invalid'), 400);
            return;
        }

        try {
            const stateJson = this.currentStory.state.toJson();
            await window.api.saveInkState(this.inkFilePath, name, stateJson);
            input.value = '';
            await this.refreshList();
        } catch (e) {
            console.error('Failed to save state:', e);
        }
    }

    private async handleLoad(name: string) {
        if (!this.currentStory || !this.inkFilePath) return;

        try {
            const stateJson = await window.api.loadInkState(this.inkFilePath, name);
            this.currentStory.state.LoadJson(stateJson);
            if (this.onStateLoaded) this.onStateLoaded(this.currentStory);
        } catch (e) {
            console.error('Failed to load state:', e);
        }
    }

    private async handleDelete(name: string) {
        if (!this.inkFilePath) return;

        try {
            await window.api.deleteInkState(this.inkFilePath, name);
            // If deleted the auto-load state, clear it
            if (this.autoLoadStateName === name) {
                this.autoLoadStateName = null;
                this.saveAutoLoadPref();
            }
            await this.refreshList();
        } catch (e) {
            console.error('Failed to delete state:', e);
        }
    }

    private handleToggleAutoLoad(name: string) {
        if (this.autoLoadStateName === name) {
            this.autoLoadStateName = null;
        } else {
            this.autoLoadStateName = name;
        }
        this.saveAutoLoadPref();
        this.renderList();
    }

    private async refreshList() {
        if (!this.inkFilePath) {
            this.stateNames = [];
            this.renderList();
            return;
        }

        try {
            this.stateNames = await window.api.listInkStates(this.inkFilePath);
            this.stateNames.sort((a, b) => a.localeCompare(b));
        } catch {
            this.stateNames = [];
        }
        this.renderList();
    }

    private renderList() {
        const listEl = document.getElementById('states-list');
        const emptyMsg = document.getElementById('states-empty');
        if (!listEl) return;

        // Remove existing items (keep empty message element)
        listEl.querySelectorAll('.states-item').forEach(el => el.remove());

        if (this.stateNames.length === 0) {
            if (emptyMsg) emptyMsg.style.display = '';
            return;
        }

        if (emptyMsg) emptyMsg.style.display = 'none';

        for (const name of this.stateNames) {
            const isAutoLoad = name === this.autoLoadStateName;

            const item = document.createElement('div');
            item.className = 'states-item' + (isAutoLoad ? ' autoload' : '');

            const nameSpan = document.createElement('span');
            nameSpan.className = 'states-item-name';
            nameSpan.textContent = name;
            item.appendChild(nameSpan);

            const actions = document.createElement('div');
            actions.className = 'states-item-actions';

            // Auto-load toggle button
            const autoloadBtn = document.createElement('div');
            autoloadBtn.className = 'states-action-btn states-autoload-btn' + (isAutoLoad ? ' active' : '');
            autoloadBtn.dataset.name = name;
            autoloadBtn.title = isAutoLoad ? 'Remove auto-load on test start' : 'Auto-load on test start';
            autoloadBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="${isAutoLoad ? 'currentColor' : 'none'}"
                stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
            </svg>`;
            actions.appendChild(autoloadBtn);

            // Load button
            const loadBtn = document.createElement('div');
            loadBtn.className = 'states-action-btn states-load-btn';
            loadBtn.dataset.name = name;
            loadBtn.title = 'Load this state';
            loadBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="7 10 12 15 17 10"/>
                <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>`;
            actions.appendChild(loadBtn);

            // Delete button
            const deleteBtn = document.createElement('div');
            deleteBtn.className = 'states-action-btn states-delete-btn';
            deleteBtn.dataset.name = name;
            deleteBtn.title = 'Delete this state';
            deleteBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="3 6 5 6 21 6"/>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
            </svg>`;
            actions.appendChild(deleteBtn);

            item.appendChild(actions);
            listEl.appendChild(item);
        }
    }

    private updateSaveButtonState() {
        const saveBtn = document.getElementById('states-save-btn');
        const nameInput = document.getElementById('states-name-input') as HTMLInputElement | null;
        const hasStory = !!this.currentStory;

        if (saveBtn) {
            if (hasStory) {
                saveBtn.classList.remove('disabled');
            } else {
                saveBtn.classList.add('disabled');
            }
        }
        if (nameInput) {
            nameInput.disabled = !hasStory;
            nameInput.placeholder = hasStory ? 'State name...' : 'Run a test first to save state';
        }
    }

    private async loadAutoLoadPref() {
        if (!this.inkFilePath || !window.api) return;
        const val = await window.api.loadPref(`autoLoadState:${this.inkFilePath}`);
        this.autoLoadStateName = val || null;
        this.renderList();
    }

    private saveAutoLoadPref() {
        if (!this.inkFilePath || !window.api) return;
        window.api.savePref(`autoLoadState:${this.inkFilePath}`, this.autoLoadStateName || '');
    }
}
