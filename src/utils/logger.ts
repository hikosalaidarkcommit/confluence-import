import { ConfluenceSettings } from '../models';
import * as path from 'path';
import * as fs from 'fs';

export class PluginLogger {
    private logFilePath: string;

    constructor(
        private settings: ConfluenceSettings,
        pluginManifestDir: string,
        vaultBasePath: string
    ) {
        // Construct absolute path to the log file in the plugin directory
        this.logFilePath = path.join(vaultBasePath, pluginManifestDir, 'debug.log');
    }

    info(message: string, data?: any) {
        this.log('INFO', message, data);
    }

    error(message: string, data?: any) {
        this.log('ERROR', message, data);
    }

    warn(message: string, data?: any) {
        this.log('WARN', message, data);
    }

    private log(level: string, message: string, data?: any) {
        if (!this.settings.enableDebugLogging) return;

        const timestamp = new Date().toISOString();
        let logMessage = `[${timestamp}] [${level}] ${message}`;
        if (data) {
            try {
                // Handle Error objects specifically to print stack
                if (data instanceof Error) {
                    logMessage += `\nStack: ${data.stack}`;
                } else {
                    logMessage += `\nData: ${JSON.stringify(data, null, 2)}`;
                }
            } catch (e) {
                logMessage += `\nData: [Circular or Non-Stringifiable Object]`;
            }
        }
        logMessage += '\n----------------------------------------\n';

        try {
            fs.appendFileSync(this.logFilePath, logMessage);
            // console.log(`[Confluence Sync] ${message}`, data);
        } catch (error) {
            console.error('[Confluence Sync] Failed to write to debug log', error);
        }
    }

    clear() {
        try {
            if (fs.existsSync(this.logFilePath)) {
                fs.writeFileSync(this.logFilePath, ''); // Clear content
            }
        } catch (e) {
            console.error('Failed to clear log', e);
        }
    }

    getLogPath(): string {
        return this.logFilePath;
    }
}
