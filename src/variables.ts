/**
 * Variables Controller
 * Displays and allows editing of Ink story global variables
 */

import type { Story } from 'inkjs';

// inkjs ValueType enum values (from inkjs/engine/Value)
// Using numeric constants to avoid importing CJS internals which cause circular dependency crashes
const VALUE_TYPE_BOOL = -1;
const VALUE_TYPE_INT = 0;
const VALUE_TYPE_FLOAT = 1;
const VALUE_TYPE_LIST = 2;
const VALUE_TYPE_STRING = 3;
const VALUE_TYPE_DIVERT_TARGET = 4;
const VALUE_TYPE_VARIABLE_POINTER = 5;

type VarType = 'int' | 'float' | 'string' | 'bool' | 'list' | 'divert' | 'pointer' | 'unknown';

interface VariableEntry {
    name: string;
    type: VarType;
    value: unknown;
    displayValue: string;
    editable: boolean;
}

export const VARIABLES_HTML = `
<div class="variables-container">
  <div class="variables-search-bar">
    <input type="text" class="variables-search" id="variables-search" placeholder="Filter variables..." />
  </div>
  <div class="variables-table-wrapper" id="variables-table-wrapper">
    <div class="live-ink-prompt" id="variables-empty">No variables to display.</div>
  </div>
</div>`;

export class VariablesController {

    private currentStory: InstanceType<typeof Story> | null = null;
    private searchTerm = '';
    private variableEntries: VariableEntry[] = [];

    public init() {
        const searchInput = document.getElementById('variables-search') as HTMLInputElement | null;
        if (searchInput) {
            searchInput.value = this.searchTerm;
            searchInput.oninput = () => {
                this.searchTerm = searchInput.value.toLowerCase();
                this.renderTable();
            };
        }
    }

    public updateFromStory(story: InstanceType<typeof Story>) {
        this.currentStory = story;
        this.variableEntries = this.enumerateVariables(story);
        this.renderTable();
    }

    public clear() {
        this.currentStory = null;
        this.variableEntries = [];
        this.renderTable();
    }

    private enumerateVariables(story: InstanceType<typeof Story>): VariableEntry[] {
        const vars = story.variablesState;
        const names = Object.keys(vars);
        names.sort((a, b) => a.localeCompare(b));

        return names.map(name => {
            const inkObj = vars.GetVariableWithName(name);
            const rawValue = vars.$(name);
            const { type, displayValue } = this.classifyVariable(inkObj, rawValue);
            const editable = type === 'int' || type === 'float' || type === 'string' || type === 'bool';

            return { name, type, value: rawValue, displayValue, editable };
        });
    }

    private classifyVariable(inkObj: any, rawValue: unknown): { type: VarType; displayValue: string } {
        if (!inkObj || inkObj.valueType === undefined) {
            return { type: 'unknown', displayValue: String(rawValue) };
        }

        switch (inkObj.valueType) {
            case VALUE_TYPE_LIST: {
                const list = inkObj.value;
                if (list && list.Count > 0) {
                    const items = list.orderedItems
                        .map((kv: { Key: { itemName: string | null } }) => kv.Key.itemName)
                        .filter(Boolean);
                    return { type: 'list', displayValue: items.join(', ') };
                }
                return { type: 'list', displayValue: '(empty list)' };
            }
            case VALUE_TYPE_BOOL:
                return { type: 'bool', displayValue: String(rawValue) };
            case VALUE_TYPE_INT:
                return { type: 'int', displayValue: String(rawValue) };
            case VALUE_TYPE_FLOAT:
                return { type: 'float', displayValue: String(rawValue) };
            case VALUE_TYPE_STRING:
                return { type: 'string', displayValue: String(rawValue) };
            case VALUE_TYPE_DIVERT_TARGET:
                return { type: 'divert', displayValue: String(rawValue) };
            case VALUE_TYPE_VARIABLE_POINTER:
                return { type: 'pointer', displayValue: String(rawValue) };
            default:
                return { type: 'unknown', displayValue: String(rawValue) };
        }
    }

    private renderTable() {
        const wrapper = document.getElementById('variables-table-wrapper');
        const emptyMsg = document.getElementById('variables-empty');
        if (!wrapper) return;

        const filtered = this.searchTerm
            ? this.variableEntries.filter(e => e.name.toLowerCase().includes(this.searchTerm))
            : this.variableEntries;

        if (filtered.length === 0) {
            // Show empty message, remove any existing table
            const existingTable = wrapper.querySelector('table');
            if (existingTable) existingTable.remove();
            if (emptyMsg) {
                emptyMsg.style.display = '';
                emptyMsg.textContent = this.variableEntries.length === 0
                    ? 'No variables to display.'
                    : 'No matching variables.';
            }
            return;
        }

        // Hide empty message
        if (emptyMsg) emptyMsg.style.display = 'none';

        // Build table
        let table = wrapper.querySelector('table.variables-table') as HTMLTableElement | null;
        if (!table) {
            table = document.createElement('table');
            table.className = 'variables-table';

            const thead = document.createElement('thead');
            thead.innerHTML = '<tr><th class="var-col-name">Name</th><th class="var-col-value">Value</th><th class="var-col-type">Type</th></tr>';
            table.appendChild(thead);

            const tbody = document.createElement('tbody');
            table.appendChild(tbody);
            wrapper.appendChild(table);
        }

        const tbody = table.querySelector('tbody')!;
        tbody.innerHTML = '';

        for (const entry of filtered) {
            const tr = document.createElement('tr');

            // Name cell
            const tdName = document.createElement('td');
            tdName.className = 'variable-name';
            tdName.textContent = entry.name;
            tr.appendChild(tdName);

            // Value cell
            const tdValue = document.createElement('td');
            tdValue.className = 'variable-value';
            if (entry.editable) {
                tdValue.contentEditable = 'true';
                tdValue.spellcheck = false;
                tdValue.textContent = entry.displayValue;
                this.attachEditHandlers(tdValue, entry);
            } else {
                tdValue.classList.add('readonly');
                tdValue.textContent = entry.displayValue;
            }
            tr.appendChild(tdValue);

            // Type cell
            const tdType = document.createElement('td');
            tdType.className = 'variable-type';
            tdType.textContent = entry.type;
            tr.appendChild(tdType);

            tbody.appendChild(tr);
        }
    }

    private attachEditHandlers(td: HTMLTableCellElement, entry: VariableEntry) {
        const originalValue = entry.displayValue;

        const commit = () => {
            const newRaw = td.textContent?.trim() ?? '';
            if (newRaw === originalValue) return;

            const result = this.trySetVariable(entry.name, newRaw, entry.type);
            if (!result.success) {
                // Flash invalid and revert
                td.classList.add('invalid');
                setTimeout(() => td.classList.remove('invalid'), 400);
                td.textContent = originalValue;
            } else {
                // Re-read the actual value from the story to confirm
                if (this.currentStory) {
                    const freshValue = this.currentStory.variablesState.$(entry.name);
                    td.textContent = String(freshValue);
                    entry.displayValue = String(freshValue);
                    entry.value = freshValue;
                }
            }
        };

        td.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                td.blur();
            }
            if (e.key === 'Escape') {
                td.textContent = originalValue;
                td.blur();
            }
        });

        td.addEventListener('blur', commit);
    }

    private trySetVariable(name: string, rawValue: string, type: VarType): { success: boolean } {
        if (!this.currentStory) return { success: false };

        try {
            switch (type) {
                case 'int': {
                    const parsed = parseInt(rawValue, 10);
                    if (isNaN(parsed) || String(parsed) !== rawValue) return { success: false };
                    this.currentStory.variablesState.$(name, parsed);
                    return { success: true };
                }
                case 'float': {
                    const parsed = parseFloat(rawValue);
                    if (isNaN(parsed)) return { success: false };
                    this.currentStory.variablesState.$(name, parsed);
                    return { success: true };
                }
                case 'string': {
                    this.currentStory.variablesState.$(name, rawValue);
                    return { success: true };
                }
                case 'bool': {
                    const lower = rawValue.toLowerCase();
                    if (lower !== 'true' && lower !== 'false') return { success: false };
                    this.currentStory.variablesState.$(name, lower === 'true');
                    return { success: true };
                }
                default:
                    return { success: false };
            }
        } catch {
            return { success: false };
        }
    }
}
