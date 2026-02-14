/**
 * Visits Controller
 * Displays visit counts for knots and stitches
 */

import type { Story } from 'inkjs';

interface VisitEntry {
    path: string;
    count: number;
}

export const VISITS_HTML = `
<div class="visits-container">
  <div class="visits-search-bar">
    <input type="text" class="visits-search" id="visits-search" placeholder="Filter visits..." />
  </div>
  <div class="visits-table-wrapper" id="visits-table-wrapper">
    <div class="live-ink-prompt" id="visits-empty">No visits to display.</div>
  </div>
</div>`;

export class VisitsController {

    private currentStory: InstanceType<typeof Story> | null = null;
    private searchTerm = '';
    private visitEntries: VisitEntry[] = [];
    private allPaths: string[] = [];

    public init() {
        const searchInput = document.getElementById('visits-search') as HTMLInputElement | null;
        if (searchInput) {
            searchInput.value = this.searchTerm;
            searchInput.oninput = () => {
                this.searchTerm = searchInput.value.toLowerCase();
                this.renderTable();
            };
        }
    }

    public setNodePaths(paths: string[]) {
        this.allPaths = paths.sort((a, b) => a.localeCompare(b));
        this.refreshVisits();
    }

    public updateFromStory(story: InstanceType<typeof Story>) {
        this.currentStory = story;
        this.refreshVisits();
    }

    public clear() {
        this.currentStory = null;
        this.visitEntries = [];
        this.renderTable();
    }

    private refreshVisits() {
        if (!this.allPaths.length) {
            this.visitEntries = [];
        } else {
            this.visitEntries = this.allPaths.map(path => {
                let count = 0;
                if (this.currentStory) {
                    count = this.currentStory.state.VisitCountAtPathString(path) || 0;
                }
                return { path, count };
            });
        }
        this.renderTable();
    }

    private renderTable() {
        const wrapper = document.getElementById('visits-table-wrapper');
        const emptyMsg = document.getElementById('visits-empty');
        if (!wrapper) return;

        const filtered = this.searchTerm
            ? this.visitEntries.filter(e => e.path.toLowerCase().includes(this.searchTerm))
            : this.visitEntries;

        if (filtered.length === 0) {
            // Show empty message, remove any existing table
            const existingTable = wrapper.querySelector('table');
            if (existingTable) existingTable.remove();
            if (emptyMsg) {
                emptyMsg.style.display = '';
                emptyMsg.textContent = this.visitEntries.length === 0
                    ? 'No visits to display.'
                    : 'No matching visits.';
            }
            return;
        }

        // Hide empty message
        if (emptyMsg) emptyMsg.style.display = 'none';

        // Build table
        let table = wrapper.querySelector('table.visits-table') as HTMLTableElement | null;
        if (!table) {
            table = document.createElement('table');
            table.className = 'visits-table';

            const thead = document.createElement('thead');
            thead.innerHTML = '<tr><th class="visit-col-path">Path</th><th class="visit-col-count">Count</th></tr>';
            table.appendChild(thead);

            const tbody = document.createElement('tbody');
            table.appendChild(tbody);
            wrapper.appendChild(table);
        }

        const tbody = table.querySelector('tbody')!;
        tbody.innerHTML = '';

        for (const entry of filtered) {
            const tr = document.createElement('tr');

            // Path cell
            const tdPath = document.createElement('td');
            tdPath.className = 'visit-path';
            tdPath.textContent = entry.path;
            tr.appendChild(tdPath);

            // Count cell
            const tdCount = document.createElement('td');
            tdCount.className = 'visit-count';
            tdCount.textContent = String(entry.count);
            tr.appendChild(tdCount);

            tbody.appendChild(tr);
        }
    }
}
