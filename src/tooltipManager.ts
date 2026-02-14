
/**
 * Tooltip Manager
 * Handles global custom tooltips for elements with data-tooltip attribute
 */

export class TooltipManager {

    private static tooltipElement: HTMLElement | null = null;
    private static isInitialized = false;

    public static init() {
        if (this.isInitialized) return;

        this.createTooltipElement();
        this.setupEventListeners();
        this.isInitialized = true;
    }

    private static createTooltipElement() {
        let tooltip = document.getElementById('live-ink-tooltip');
        if (!tooltip) {
            tooltip = document.createElement('div');
            tooltip.id = 'live-ink-tooltip';
            tooltip.className = 'live-ink-tooltip';
            document.body.appendChild(tooltip);
        }
        this.tooltipElement = tooltip;
    }

    private static setupEventListeners() {
        document.addEventListener('mouseover', (e) => {
            const target = (e.target as HTMLElement).closest('[data-tooltip]') as HTMLElement;
            if (target) {
                this.showTooltip(target);
            }
        });

        document.addEventListener('mouseout', (e) => {
            const target = (e.target as HTMLElement).closest('[data-tooltip]') as HTMLElement;
            if (target) {
                const related = e.relatedTarget as HTMLElement;
                if (!related || !target.contains(related)) {
                    this.hideTooltip();
                }
            }
        });

        document.addEventListener('mousedown', () => this.hideTooltip());
    }

    private static showTooltip(target: HTMLElement) {
        if (!this.tooltipElement) return;

        const text = target.getAttribute('data-tooltip');
        if (!text) return;

        this.tooltipElement.textContent = text;
        const rect = target.getBoundingClientRect();

        // Position tooltip
        // Default: bottom
        let top = rect.bottom + 8;
        // Flip if too close to bottom
        if (top + 30 > window.innerHeight) {
            top = rect.top - 30;
        }

        // Center horizontally
        let left = rect.left + (rect.width / 2) - (this.tooltipElement.offsetWidth / 2);
        // Clamp
        if (left < 4) left = 4;
        if (left + this.tooltipElement.offsetWidth > window.innerWidth - 4) {
            left = window.innerWidth - this.tooltipElement.offsetWidth - 4;
        }

        this.tooltipElement.style.top = `${top}px`;
        this.tooltipElement.style.left = `${left}px`;
        this.tooltipElement.classList.add('visible');
    }

    private static hideTooltip() {
        if (this.tooltipElement) {
            this.tooltipElement.classList.remove('visible');
        }
    }
}
