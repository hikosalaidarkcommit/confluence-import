/**
 * Honest module declarations for `turndown` and `turndown-plugin-gfm`,
 * covering exactly the API surface this plugin uses (constructor options,
 * addRule, use, turndown). Written against turndown@7 / turndown-plugin-gfm@1
 * observed behavior — no `any` leaks into consuming code.
 */
declare module 'turndown' {
    export interface TurndownOptions {
        headingStyle?: 'setext' | 'atx';
        codeBlockStyle?: 'indented' | 'fenced';
        emDelimiter?: '_' | '*';
        bulletListMarker?: '-' | '+' | '*';
        blankReplacement?: (content: string, node: Node) => string;
    }

    export interface TurndownRule {
        filter:
            | string
            | string[]
            | ((node: HTMLElement, options: TurndownOptions) => boolean);
        replacement: (
            content: string,
            node: HTMLElement,
            options: TurndownOptions
        ) => string;
    }

    export type TurndownPlugin = (service: TurndownService) => void;

    export default class TurndownService {
        constructor(options?: TurndownOptions);
        addRule(name: string, rule: TurndownRule): this;
        use(plugin: TurndownPlugin | TurndownPlugin[]): this;
        turndown(input: string | Node): string;
    }
}

declare module 'turndown-plugin-gfm' {
    import type { TurndownPlugin } from 'turndown';
    export const gfm: TurndownPlugin;
    export const tables: TurndownPlugin;
    export const strikethrough: TurndownPlugin;
    export const taskListItems: TurndownPlugin;
}
