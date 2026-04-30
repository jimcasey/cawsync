export type ConflictPolicy = 'always-ask' | 'always-prefer-local' | 'always-prefer-remote';

export interface Settings {
	owner: string;
	repo: string;
	branch: string;
	pat: string;
	conflictPolicy: ConflictPolicy;
	perFileSizeLimitMb: number;
	deviceName: string;
	includeObsidianConfig: boolean;
	excludePatterns: string[];
	verboseLogging: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
	owner: '',
	repo: '',
	branch: 'main',
	pat: '',
	conflictPolicy: 'always-ask',
	perFileSizeLimitMb: 25,
	deviceName: '',
	includeObsidianConfig: false,
	excludePatterns: ['*.tmp', '*.swp', '.DS_Store', 'Thumbs.db', '.trash/**'],
	verboseLogging: false,
};
