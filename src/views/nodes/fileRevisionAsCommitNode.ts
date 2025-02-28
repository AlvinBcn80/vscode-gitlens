import {
	Command,
	MarkdownString,
	Selection,
	ThemeColor,
	ThemeIcon,
	TreeItem,
	TreeItemCollapsibleState,
	Uri,
} from 'vscode';
import type { DiffWithPreviousCommandArgs } from '../../commands';
import { Colors, Commands } from '../../constants';
import { CommitFormatter, StatusFileFormatter } from '../../git/formatters';
import { GitUri } from '../../git/gitUri';
import { GitBranch, GitCommit, GitFile, GitRevisionReference } from '../../git/models';
import { joinPaths } from '../../system/path';
import { FileHistoryView } from '../fileHistoryView';
import { LineHistoryView } from '../lineHistoryView';
import { ViewsWithCommits } from '../viewBase';
import { MergeConflictCurrentChangesNode } from './mergeConflictCurrentChangesNode';
import { MergeConflictIncomingChangesNode } from './mergeConflictIncomingChangesNode';
import { ContextValues, ViewNode, ViewRefFileNode } from './viewNode';

export class FileRevisionAsCommitNode extends ViewRefFileNode<ViewsWithCommits | FileHistoryView | LineHistoryView> {
	constructor(
		view: ViewsWithCommits | FileHistoryView | LineHistoryView,
		parent: ViewNode,
		public readonly file: GitFile,
		public commit: GitCommit,
		private readonly _options: {
			branch?: GitBranch;
			getBranchAndTagTips?: (sha: string, options?: { compact?: boolean }) => string | undefined;
			selection?: Selection;
			unpublished?: boolean;
		} = {},
	) {
		super(GitUri.fromFile(file, commit.repoPath, commit.sha), view, parent);
	}

	override toClipboard(): string {
		return `${this.commit.shortSha}: ${this.commit.summary}`;
	}

	get fileName(): string {
		return this.file.path;
	}

	get isTip(): boolean {
		return (this._options.branch?.current && this._options.branch.sha === this.commit.ref) ?? false;
	}

	get ref(): GitRevisionReference {
		return this.commit;
	}

	async getChildren(): Promise<ViewNode[]> {
		if (!this.commit.file?.hasConflicts) return [];

		const [mergeStatus, rebaseStatus] = await Promise.all([
			this.view.container.git.getMergeStatus(this.commit.repoPath),
			this.view.container.git.getRebaseStatus(this.commit.repoPath),
		]);
		if (mergeStatus == null && rebaseStatus == null) return [];

		return [
			new MergeConflictCurrentChangesNode(this.view, this, (mergeStatus ?? rebaseStatus)!, this.file),
			new MergeConflictIncomingChangesNode(this.view, this, (mergeStatus ?? rebaseStatus)!, this.file),
		];
	}

	async getTreeItem(): Promise<TreeItem> {
		if (this.commit.file == null) {
			// Try to get the commit directly from the multi-file commit
			const commit = await this.commit.getCommitForFile(this.file);
			if (commit == null) {
				const log = await this.view.container.git.getLogForFile(this.repoPath, this.file.path, {
					limit: 2,
					ref: this.commit.sha,
				});
				if (log != null) {
					this.commit = log.commits.get(this.commit.sha) ?? this.commit;
				}
			} else {
				this.commit = commit;
			}
		}

		const item = new TreeItem(
			CommitFormatter.fromTemplate(this.view.config.formats.commits.label, this.commit, {
				dateFormat: this.view.container.config.defaultDateFormat,
				getBranchAndTagTips: (sha: string) => this._options.getBranchAndTagTips?.(sha, { compact: true }),
				messageTruncateAtNewLine: true,
			}),
			this.commit.file?.hasConflicts ? TreeItemCollapsibleState.Expanded : TreeItemCollapsibleState.None,
		);

		item.contextValue = this.contextValue;

		item.description = CommitFormatter.fromTemplate(this.view.config.formats.commits.description, this.commit, {
			dateFormat: this.view.container.config.defaultDateFormat,
			getBranchAndTagTips: (sha: string) => this._options.getBranchAndTagTips?.(sha, { compact: true }),
			messageTruncateAtNewLine: true,
		});

		item.resourceUri = Uri.parse(`gitlens-view://commit-file/status/${this.file.status}`);

		if (!this.commit.isUncommitted && this.view.config.avatars) {
			item.iconPath = this._options.unpublished
				? new ThemeIcon('arrow-up', new ThemeColor(Colors.UnpublishedCommitIconColor))
				: await this.commit.getAvatarUri({ defaultStyle: this.view.container.config.defaultGravatarsStyle });
		}

		if (item.iconPath == null) {
			const icon = GitFile.getStatusIcon(this.file.status);
			item.iconPath = {
				dark: this.view.container.context.asAbsolutePath(joinPaths('images', 'dark', icon)),
				light: this.view.container.context.asAbsolutePath(joinPaths('images', 'light', icon)),
			};
		}

		item.command = this.getCommand();

		return item;
	}

	protected get contextValue(): string {
		if (!this.commit.isUncommitted) {
			return `${ContextValues.File}+committed${this._options.branch?.current ? '+current' : ''}${
				this.isTip ? '+HEAD' : ''
			}${this._options.unpublished ? '+unpublished' : ''}`;
		}

		return this.commit.file?.hasConflicts
			? `${ContextValues.File}+conflicted`
			: this.commit.isUncommittedStaged
			? `${ContextValues.File}+staged`
			: `${ContextValues.File}+unstaged`;
	}

	override getCommand(): Command | undefined {
		let line;
		if (this.commit.lines.length) {
			line = this.commit.lines[0].line - 1;
		} else {
			line = this._options.selection?.active.line ?? 0;
		}

		if (this.commit.file?.hasConflicts) {
			return {
				title: 'Open Changes',
				command: Commands.DiffWith,
				arguments: [
					{
						lhs: {
							sha: 'MERGE_HEAD',
							uri: GitUri.fromFile(this.file, this.repoPath, undefined, true),
						},
						rhs: {
							sha: 'HEAD',
							uri: GitUri.fromFile(this.file, this.repoPath),
						},
						repoPath: this.repoPath,
						line: 0,
						showOptions: {
							preserveFocus: false,
							preview: false,
						},
					},
				],
			};
		}

		const commandArgs: DiffWithPreviousCommandArgs = {
			commit: this.commit,
			uri: GitUri.fromFile(this.file, this.commit.repoPath),
			line: line,
			showOptions: {
				preserveFocus: true,
				preview: true,
			},
		};
		return {
			title: 'Open Changes with Previous Revision',
			command: Commands.DiffWithPrevious,
			arguments: [undefined, commandArgs],
		};
	}

	override async resolveTreeItem(item: TreeItem): Promise<TreeItem> {
		if (item.tooltip == null) {
			item.tooltip = await this.getTooltip();
		}
		return item;
	}

	async getConflictBaseUri(): Promise<Uri | undefined> {
		if (!this.commit.file?.hasConflicts) return undefined;

		const mergeBase = await this.view.container.git.getMergeBase(this.repoPath, 'MERGE_HEAD', 'HEAD');
		return GitUri.fromFile(this.file, this.repoPath, mergeBase ?? 'HEAD');
	}

	private async getTooltip() {
		const remotes = await this.view.container.git.getRemotesWithProviders(this.commit.repoPath);
		const remote = await this.view.container.git.getRichRemoteProvider(remotes);

		if (this.commit.message == null) {
			await this.commit.ensureFullDetails();
		}

		let autolinkedIssuesOrPullRequests;
		let pr;

		if (remote?.provider != null) {
			[autolinkedIssuesOrPullRequests, pr] = await Promise.all([
				this.view.container.autolinks.getIssueOrPullRequestLinks(
					this.commit.message ?? this.commit.summary,
					remote,
				),
				this.view.container.git.getPullRequestForCommit(this.commit.ref, remote.provider),
			]);
		}

		const status = StatusFileFormatter.fromTemplate(`\${status}\${ (originalPath)}`, this.file);
		const tooltip = await CommitFormatter.fromTemplateAsync(
			`\${link}\${' via 'pullRequest} \u2022 ${status}\${ \u2022 changesDetail}\${'&nbsp;&nbsp;&nbsp;'tips}\n\n\${avatar} &nbsp;__\${author}__, \${ago} &nbsp; _(\${date})_ \n\n\${message}\${\n\n---\n\nfootnotes}`,
			this.commit,
			{
				autolinkedIssuesOrPullRequests: autolinkedIssuesOrPullRequests,
				dateFormat: this.view.container.config.defaultDateFormat,
				getBranchAndTagTips: this._options.getBranchAndTagTips,
				markdown: true,
				messageAutolinks: true,
				messageIndent: 4,
				pullRequestOrRemote: pr,
				remotes: remotes,
				unpublished: this._options.unpublished,
			},
		);

		const markdown = new MarkdownString(tooltip, true);
		markdown.supportHtml = true;
		markdown.isTrusted = true;

		return markdown;
	}
}
