import type { Config } from '../config';

export interface IpcMessage {
	id: string;
	method: string;
	params?: unknown;
}

abstract class IpcMessageType<Params = void> {
	_?: Params; // Required for type inferencing to work properly
	constructor(public readonly method: string) {}
}
export type IpcMessageParams<T> = T extends IpcMessageType<infer P> ? P : never;

/**
 * Commands are sent from the webview to the extension
 */
export class IpcCommandType<Params = void> extends IpcMessageType<Params> {}
/**
 * Notifications are sent from the extension to the webview
 */
export class IpcNotificationType<Params = void> extends IpcMessageType<Params> {}

export function onIpc<T extends IpcMessageType<any>>(
	type: T,
	msg: IpcMessage,
	fn: (params: IpcMessageParams<T>) => unknown,
) {
	if (type.method !== msg.method) return;

	fn(msg.params as IpcMessageParams<T>);
}

// COMMANDS

export const WebviewReadyCommandType = new IpcCommandType('webview/ready');

export interface ExecuteCommandParams {
	command: string;
	args?: [];
}
export const ExecuteCommandType = new IpcCommandType<ExecuteCommandParams>('command/execute');

export interface GenerateCommitPreviewParams {
	key: string;
	type: 'commit';
	format: string;
}

type GenerateConfigurationPreviewParams = GenerateCommitPreviewParams;
export const GenerateConfigurationPreviewCommandType = new IpcCommandType<GenerateConfigurationPreviewParams>(
	'configuration/preview',
);

export interface UpdateConfigurationParams {
	changes: {
		[key: string]: any;
	};
	removes: string[];
	scope?: 'user' | 'workspace';
	uri?: string;
}
export const UpdateConfigurationCommandType = new IpcCommandType<UpdateConfigurationParams>('configuration/update');

// NOTIFICATIONS

export interface DidChangeConfigurationParams {
	config: Config;
	customSettings: Record<string, boolean>;
}
export const DidChangeConfigurationNotificationType = new IpcNotificationType<DidChangeConfigurationParams>(
	'configuration/didChange',
);

export interface DidGenerateConfigurationPreviewParams {
	completionId: string;
	preview: string;
}
export const DidGenerateConfigurationPreviewNotificationType =
	new IpcNotificationType<DidGenerateConfigurationPreviewParams>('configuration/didPreview');
