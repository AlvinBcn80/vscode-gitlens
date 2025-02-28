import { commands, workspace } from 'vscode';
import { configuration } from '../../configuration';
import { Commands } from '../../constants';
import type { Container } from '../../container';
import { WebviewWithConfigBase } from '../webviewWithConfigBase';
import { DidJumpToNotificationType, State } from './protocol';

const anchorRegex = /.*?#(.*)/;

export class SettingsWebview extends WebviewWithConfigBase<State> {
	private _pendingJumpToAnchor: string | undefined;

	constructor(container: Container) {
		super(
			container,
			'gitlens.settings',
			'settings.html',
			'images/gitlens-icon.png',
			'GitLens Settings',
			Commands.ShowSettingsPage,
		);

		this.disposables.push(
			...[
				Commands.ShowSettingsPageAndJumpToBranchesView,
				Commands.ShowSettingsPageAndJumpToCommitsView,
				Commands.ShowSettingsPageAndJumpToContributorsView,
				Commands.ShowSettingsPageAndJumpToFileHistoryView,
				Commands.ShowSettingsPageAndJumpToLineHistoryView,
				Commands.ShowSettingsPageAndJumpToRemotesView,
				Commands.ShowSettingsPageAndJumpToRepositoriesView,
				Commands.ShowSettingsPageAndJumpToSearchAndCompareView,
				Commands.ShowSettingsPageAndJumpToStashesView,
				Commands.ShowSettingsPageAndJumpToTagsView,
				Commands.ShowSettingsPageAndJumpToViews,
			].map(c => {
				// The show and jump commands are structured to have a # separating the base command from the anchor
				let anchor: string | undefined;
				const match = anchorRegex.exec(c);
				if (match != null) {
					[, anchor] = match;
				}

				return commands.registerCommand(c, () => this.onShowCommand(anchor), this);
			}),
		);
	}

	protected override onReady() {
		if (this._pendingJumpToAnchor != null) {
			void this.notify(DidJumpToNotificationType, {
				anchor: this._pendingJumpToAnchor,
			});
			this._pendingJumpToAnchor = undefined;
		}
	}

	protected override onShowCommand(anchor?: string) {
		if (anchor) {
			this._pendingJumpToAnchor = anchor;
		}
		super.onShowCommand();
	}

	protected override includeBootstrap(): State {
		const scopes: ['user' | 'workspace', string][] = [['user', 'User']];
		if (workspace.workspaceFolders?.length) {
			scopes.push(['workspace', 'Workspace']);
		}

		return {
			// Make sure to get the raw config, not from the container which has the modes mixed in
			config: configuration.get(),
			customSettings: this.getCustomSettings(),
			scope: 'user',
			scopes: scopes,
		};
	}
}
