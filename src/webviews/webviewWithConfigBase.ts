import { ConfigurationChangeEvent, ConfigurationTarget, WebviewPanelOnDidChangeViewStateEvent } from 'vscode';
import { configuration } from '../configuration';
import { Commands } from '../constants';
import type { Container } from '../container';
import { CommitFormatter } from '../git/formatters';
import {
	GitCommit,
	GitCommitIdentity,
	GitFileChange,
	GitFileIndexStatus,
	PullRequest,
	PullRequestState,
} from '../git/models';
import { Logger } from '../logger';
import {
	DidChangeConfigurationNotificationType,
	DidGenerateConfigurationPreviewNotificationType,
	GenerateConfigurationPreviewCommandType,
	IpcMessage,
	onIpc,
	UpdateConfigurationCommandType,
} from './protocol';
import { WebviewBase } from './webviewBase';

export abstract class WebviewWithConfigBase<State> extends WebviewBase<State> {
	constructor(
		container: Container,
		id: string,
		fileName: string,
		iconPath: string,
		title: string,
		showCommand: Commands,
	) {
		super(container, id, fileName, iconPath, title, showCommand);
		this.disposables.push(
			configuration.onDidChange(this.onConfigurationChanged, this),
			configuration.onDidChangeAny(this.onAnyConfigurationChanged, this),
		);
	}

	private onAnyConfigurationChanged(e: ConfigurationChangeEvent) {
		let notify = false;
		for (const setting of this.customSettings.values()) {
			if (e.affectsConfiguration(setting.name)) {
				notify = true;
				break;
			}
		}

		if (!notify) return;

		void this.notifyDidChangeConfiguration();
	}

	private onConfigurationChanged(_e: ConfigurationChangeEvent) {
		void this.notifyDidChangeConfiguration();
	}

	protected override onViewStateChanged(e: WebviewPanelOnDidChangeViewStateEvent): void {
		super.onViewStateChanged(e);

		// Anytime the webview becomes active, make sure it has the most up-to-date config
		if (e.webviewPanel.active) {
			void this.notifyDidChangeConfiguration();
		}
	}

	protected override onMessageReceivedCore(e: IpcMessage): void {
		if (e == null) return;

		switch (e.method) {
			case UpdateConfigurationCommandType.method:
				Logger.log(`Webview(${this.id}).onMessageReceived: method=${e.method}, data=${JSON.stringify(e)}`);

				onIpc(UpdateConfigurationCommandType, e, async params => {
					const target =
						params.scope === 'workspace' ? ConfigurationTarget.Workspace : ConfigurationTarget.Global;

					for (const key in params.changes) {
						let value = params.changes[key];

						const customSetting = this.customSettings.get(key);
						if (customSetting != null) {
							await customSetting.update(value);

							continue;
						}

						const inspect = configuration.inspect(key as any)!;

						if (value != null) {
							if (params.scope === 'workspace') {
								if (value === inspect.workspaceValue) continue;
							} else {
								if (value === inspect.globalValue && value !== inspect.defaultValue) continue;

								if (value === inspect.defaultValue) {
									value = undefined;
								}
							}
						}

						void (await configuration.update(key as any, value, target));
					}

					for (const key of params.removes) {
						void (await configuration.update(key as any, undefined, target));
					}
				});
				break;

			case GenerateConfigurationPreviewCommandType.method:
				Logger.log(`Webview(${this.id}).onMessageReceived: method=${e.method}, data=${JSON.stringify(e)}`);

				onIpc(GenerateConfigurationPreviewCommandType, e, async params => {
					switch (params.type) {
						case 'commit': {
							const commit = new GitCommit(
								this.container,
								'~/code/eamodio/vscode-gitlens-demo',
								'fe26af408293cba5b4bfd77306e1ac9ff7ccaef8',
								new GitCommitIdentity('You', 'eamodio@gmail.com', new Date('2016-11-12T20:41:00.000Z')),
								new GitCommitIdentity('You', 'eamodio@gmail.com', new Date('2020-11-01T06:57:21.000Z')),
								'Supercharged',
								['3ac1d3f51d7cf5f438cc69f25f6740536ad80fef'],
								'Supercharged',
								new GitFileChange(
									'~/code/eamodio/vscode-gitlens-demo',
									'code.ts',
									GitFileIndexStatus.Modified,
								),
								undefined,
								[],
							);

							let includePullRequest = false;
							switch (params.key) {
								case configuration.name('currentLine.format'):
									includePullRequest = this.container.config.currentLine.pullRequests.enabled;
									break;
								case configuration.name('statusBar.format'):
									includePullRequest = this.container.config.statusBar.pullRequests.enabled;
									break;
							}

							let pr: PullRequest | undefined;
							if (includePullRequest) {
								pr = new PullRequest(
									{ id: 'github', name: 'GitHub', domain: 'github.com' },
									{
										name: 'Eric Amodio',
										avatarUrl: 'https://avatars1.githubusercontent.com/u/641685?s=32&v=4',
										url: 'https://github.com/eamodio',
									},
									'1',
									'Supercharged',
									'https://github.com/eamodio/vscode-gitlens/pulls/1',
									PullRequestState.Merged,
									new Date('Sat, 12 Nov 2016 19:41:00 GMT'),
									undefined,
									new Date('Sat, 12 Nov 2016 20:41:00 GMT'),
								);
							}

							let preview;
							try {
								preview = CommitFormatter.fromTemplate(params.format, commit, {
									dateFormat: this.container.config.defaultDateFormat,
									pullRequestOrRemote: pr,
									messageTruncateAtNewLine: true,
								});
							} catch {
								preview = 'Invalid format';
							}

							await this.notify(DidGenerateConfigurationPreviewNotificationType, {
								completionId: e.id,
								preview: preview,
							});
						}
					}
				});
				break;

			default:
				super.onMessageReceivedCore(e);
		}
	}

	private _customSettings: Map<string, CustomSetting> | undefined;
	private get customSettings() {
		if (this._customSettings == null) {
			this._customSettings = new Map<string, CustomSetting>([
				[
					'rebaseEditor.enabled',
					{
						name: 'workbench.editorAssociations',
						enabled: () => this.container.rebaseEditor.enabled,
						update: this.container.rebaseEditor.setEnabled,
					},
				],
			]);
		}
		return this._customSettings;
	}

	protected getCustomSettings(): Record<string, boolean> {
		const customSettings = Object.create(null);
		for (const [key, setting] of this.customSettings) {
			customSettings[key] = setting.enabled();
		}
		return customSettings;
	}

	private notifyDidChangeConfiguration() {
		// Make sure to get the raw config, not from the container which has the modes mixed in
		return this.notify(DidChangeConfigurationNotificationType, {
			config: configuration.get(),
			customSettings: this.getCustomSettings(),
		});
	}
}

interface CustomSetting {
	name: string;
	enabled: () => boolean;
	update: (enabled: boolean) => Promise<void>;
}
