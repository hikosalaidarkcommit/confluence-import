import { EditorView, Decoration, DecorationSet, ViewPlugin, ViewUpdate, WidgetType } from '@codemirror/view';
import { StateField, StateEffect } from '@codemirror/state';
import { ConflictMarker, ConflictRegion } from '../conflict/conflict-marker';

/**
 * Widget for conflict action buttons (like VS Code)
 */
class ConflictActionsWidget extends WidgetType {
    constructor(
        private conflictIndex: number,
        private totalConflicts: number,
        private onAction: (action: 'current' | 'incoming' | 'both') => void
    ) {
        super();
    }

    toDOM() {
        const container = document.createElement('div');
        container.className = 'conflict-actions-inline';

        // Conflict indicator
        const indicator = container.createSpan({ cls: 'conflict-indicator' });
        indicator.setText(`Conflict ${this.conflictIndex + 1} of ${this.totalConflicts}`);

        // Action buttons container
        const actions = container.createDiv({ cls: 'conflict-actions-buttons' });

        // Accept Current Change
        const acceptCurrent = actions.createEl('button', {
            text: 'Accept Current Change',
            cls: 'conflict-action-btn accept-current'
        });
        acceptCurrent.onclick = (e) => {
            e.preventDefault();
            this.onAction('current');
        };

        // Separator
        actions.createSpan({ text: ' | ', cls: 'conflict-separator' });

        // Accept Incoming Change
        const acceptIncoming = actions.createEl('button', {
            text: 'Accept Incoming Change',
            cls: 'conflict-action-btn accept-incoming'
        });
        acceptIncoming.onclick = (e) => {
            e.preventDefault();
            this.onAction('incoming');
        };

        // Separator
        actions.createSpan({ text: ' | ', cls: 'conflict-separator' });

        // Accept Both Changes
        const acceptBoth = actions.createEl('button', {
            text: 'Accept Both Changes',
            cls: 'conflict-action-btn accept-both'
        });
        acceptBoth.onclick = (e) => {
            e.preventDefault();
            this.onAction('both');
        };

        return container;
    }
}

/**
 * State effect to trigger conflict resolution
 */
export const resolveConflictEffect = StateEffect.define<{
    region: ConflictRegion;
    resolution: 'current' | 'incoming' | 'both';
}>();

/**
 * CodeMirror extension for VS Code-style conflict resolution
 */
export function conflictResolutionExtension() {
    const conflictMarker = new ConflictMarker();

    // View plugin to add decorations (action buttons and highlighting)
    const conflictDecorations = ViewPlugin.fromClass(class {
        decorations: DecorationSet;

        constructor(view: EditorView) {
            this.decorations = this.buildDecorations(view);
        }

        update(update: ViewUpdate) {
            if (update.docChanged || update.viewportChanged) {
                this.decorations = this.buildDecorations(update.view);
            }

            // Handle conflict resolution effects
            for (const tr of update.transactions) {
                for (const effect of tr.effects) {
                    if (effect.is(resolveConflictEffect)) {
                        this.handleConflictResolution(update.view, effect.value);
                    }
                }
            }
        }

        buildDecorations(view: EditorView): DecorationSet {
            const content = view.state.doc.toString();
            const regions = conflictMarker.detectMarkers(content);

            if (regions.length === 0) {
                return Decoration.none;
            }

            const decorations: any[] = [];

            regions.forEach((region, index) => {
                // Add action buttons widget above the conflict
                const widgetDeco = Decoration.widget({
                    widget: new ConflictActionsWidget(
                        index,
                        regions.length,
                        (action) => {
                            view.dispatch({
                                effects: resolveConflictEffect.of({
                                    region,
                                    resolution: action
                                })
                            });
                        }
                    ),
                    side: 1,
                    block: true
                });
                decorations.push(widgetDeco.range(
                    view.state.doc.line(region.markerStart + 1).from
                ));

                // Highlight conflict regions
                // Current change (green)
                const currentStart = view.state.doc.line(region.markerStart + 2).from;
                const currentEnd = view.state.doc.line(region.markerMiddle).from;
                decorations.push(
                    Decoration.line({
                        class: 'conflict-region-current'
                    }).range(currentStart)
                );

                // Incoming change (blue)
                const incomingStart = view.state.doc.line(region.markerMiddle + 2).from;
                const incomingEnd = view.state.doc.line(region.markerEnd).from;
                decorations.push(
                    Decoration.line({
                        class: 'conflict-region-incoming'
                    }).range(incomingStart)
                );
            });

            return Decoration.set(decorations);
        }

        handleConflictResolution(view: EditorView, data: { region: ConflictRegion; resolution: 'current' | 'incoming' | 'both' }) {
            const content = view.state.doc.toString();
            const resolved = conflictMarker.resolveConflict(content, data.region, data.resolution);

            // Update document
            view.dispatch({
                changes: {
                    from: 0,
                    to: view.state.doc.length,
                    insert: resolved
                }
            });
        }
    }, {
        decorations: v => v.decorations
    });

    return [conflictDecorations];
}
