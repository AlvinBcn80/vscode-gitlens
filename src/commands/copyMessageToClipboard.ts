import { env, TextEditor, Uri } from 'vscode';
import { Commands } from '../constants';
import type { Container } from '../container';
import { GitUri } from '../git/gitUri';
import { Logger } from '../logger';
import { Messages } from '../messages';
import { command } from '../system/command';
import { first } from '../system/iterable';
import {
	ActiveEditorCommand,
	CommandContext,
	getCommandUri,
	isCommandContextViewNodeHasBranch,
	isCommandContextViewNodeHasCommit,
	isCommandContextViewNodeHasTag,
} from './base';
import { GitActions } from './gitCommands.actions';

export interface CopyMessageToClipboardCommandArgs {
	message?: string;
	sha?: string;
}

@command()
export class CopyMessageToClipboardCommand extends ActiveEditorCommand {
	constructor(private readonly container: Container) {
		super(Commands.CopyMessageToClipboard);
	}

	protected override preExecute(context: CommandContext, args?: CopyMessageToClipboardCommandArgs) {
		if (isCommandContextViewNodeHasCommit(context)) {
			args = { ...args };
			args.sha = context.node.commit.sha;
			return this.execute(context.editor, context.node.commit.file?.uri, args);
		} else if (isCommandContextViewNodeHasBranch(context)) {
			args = { ...args };
			args.sha = context.node.branch.sha;
			return this.execute(context.editor, context.node.uri, args);
		} else if (isCommandContextViewNodeHasTag(context)) {
			args = { ...args };
			args.sha = context.node.tag.sha;
			return this.execute(context.editor, context.node.uri, args);
		}

		return this.execute(context.editor, context.uri, args);
	}

	async execute(editor?: TextEditor, uri?: Uri, args?: CopyMessageToClipboardCommandArgs) {
		uri = getCommandUri(uri, editor);
		args = { ...args };

		try {
			let repoPath;

			// If we don't have an editor then get the message of the last commit to the branch
			if (uri == null) {
				repoPath = this.container.git.getBestRepository(editor)?.path;
				if (!repoPath) return;

				const log = await this.container.git.getLog(repoPath, { limit: 1 });
				if (log == null) return;

				const commit = first(log.commits.values());
				if (commit?.message == null) return;

				args.message = commit.message;
			} else if (args.message == null) {
				const gitUri = await GitUri.fromUri(uri);
				repoPath = gitUri.repoPath;

				if (args.sha == null) {
					const blameline = editor?.selection.active.line ?? 0;
					if (blameline < 0) return;

					try {
						const blame = await this.container.git.getBlameForLine(gitUri, blameline, editor?.document);
						if (blame == null || blame.commit.isUncommitted) return;

						void (await GitActions.Commit.copyMessageToClipboard(blame.commit));
						return;
					} catch (ex) {
						Logger.error(ex, 'CopyMessageToClipboardCommand', `getBlameForLine(${blameline})`);
						void Messages.showGenericErrorMessage('Unable to copy message');

						return;
					}
				} else {
					void (await GitActions.Commit.copyMessageToClipboard({ ref: args.sha, repoPath: repoPath! }));
					return;
				}
			}

			void (await env.clipboard.writeText(args.message));
		} catch (ex) {
			Logger.error(ex, 'CopyMessageToClipboardCommand');
			void Messages.showGenericErrorMessage('Unable to copy message');
		}
	}
}
