import { Uri } from 'vscode';
import { decodeUtf8Hex, encodeUtf8Hex } from '@env/hex';
import { UriComparer } from '../comparers';
import { Schemes } from '../constants';
import { Container } from '../container';
import { Logger } from '../logger';
import type { GitHubAuthorityMetadata } from '../premium/remotehub';
import { debug } from '../system/decorators/log';
import { memoize } from '../system/decorators/memoize';
import { formatPath } from '../system/formatPath';
import { basename, getBestPath, normalizePath, relativeDir, splitPath } from '../system/path';
// import { CharCode } from '../system/string';
import type { RevisionUriData } from './gitProvider';
import { GitFile, GitRevision } from './models';

const slash = 47; //CharCode.Slash;

export interface GitCommitish {
	fileName?: string;
	repoPath: string;
	sha?: string;
}

interface UriComponents {
	scheme?: string;
	authority?: string;
	path?: string;
	query?: string;
	fragment?: string;
}

interface UriEx {
	new (): Uri;
	new (scheme: string, authority: string, path: string, query: string, fragment: string): Uri;
	// Use this ctor, because vscode doesn't validate it
	new (components: UriComponents): Uri;
}

export class GitUri extends (Uri as any as UriEx) {
	private static readonly _unknown = new GitUri();
	static get unknown() {
		return this._unknown;
	}

	static is(uri: any): uri is GitUri {
		return uri instanceof GitUri;
	}

	readonly repoPath?: string;
	readonly sha?: string;

	constructor(uri?: Uri);
	constructor(uri: Uri, commit: GitCommitish);
	constructor(uri: Uri, repoPath: string | undefined);
	constructor(uri?: Uri, commitOrRepoPath?: GitCommitish | string) {
		if (uri == null) {
			super({ scheme: 'unknown' });

			return;
		}

		if (uri.scheme === Schemes.GitLens) {
			super({
				scheme: uri.scheme,
				authority: uri.authority,
				path: uri.path,
				query: uri.query,
				fragment: uri.fragment,
			});

			const metadata = decodeGitLensRevisionUriAuthority<RevisionUriData>(uri.authority);
			this.repoPath = metadata.repoPath;

			let ref = metadata.ref;
			if (commitOrRepoPath != null && typeof commitOrRepoPath !== 'string') {
				ref = commitOrRepoPath.sha;
			}

			if (GitRevision.isUncommittedStaged(ref) || !GitRevision.isUncommitted(ref)) {
				this.sha = ref;
			}

			return;
		}

		if (uri.scheme === Schemes.Virtual || uri.scheme === Schemes.GitHub) {
			super(uri);

			const [, owner, repo] = uri.path.split('/', 3);
			this.repoPath = uri.with({ path: `/${owner}/${repo}` }).toString();

			const data = decodeRemoteHubAuthority<GitHubAuthorityMetadata>(uri);

			let ref = data.metadata?.ref?.id;
			if (commitOrRepoPath != null && typeof commitOrRepoPath !== 'string') {
				ref = commitOrRepoPath.sha;
			}

			if (ref && (GitRevision.isUncommittedStaged(ref) || !GitRevision.isUncommitted(ref))) {
				this.sha = ref;
			}

			return;
		}

		if (commitOrRepoPath === undefined) {
			super(uri);

			return;
		}

		if (typeof commitOrRepoPath === 'string') {
			super(uri);

			this.repoPath = commitOrRepoPath;

			return;
		}

		let authority = uri.authority;
		let fsPath = normalizePath(
			Container.instance.git.getAbsoluteUri(commitOrRepoPath.fileName ?? uri.fsPath, commitOrRepoPath.repoPath)
				.fsPath,
		);

		// Check for authority as used in UNC shares or use the path as given
		if (fsPath.charCodeAt(0) === slash && fsPath.charCodeAt(1) === slash) {
			const index = fsPath.indexOf('/', 2);
			if (index === -1) {
				authority = fsPath.substring(2);
				fsPath = '/';
			} else {
				authority = fsPath.substring(2, index);
				fsPath = fsPath.substring(index) || '/';
			}
		}

		let path;
		switch (uri.scheme) {
			case 'https':
			case 'http':
			case 'file':
				if (!fsPath) {
					path = '/';
				} else if (fsPath.charCodeAt(0) !== slash) {
					path = `/${fsPath}`;
				} else {
					path = fsPath;
				}
				break;
			default:
				path = fsPath.charCodeAt(0) !== slash ? `/${fsPath}` : fsPath;
				break;
		}

		super({
			scheme: uri.scheme,
			authority: authority,
			path: path,
			query: uri.query,
			fragment: uri.fragment,
		});
		this.repoPath = commitOrRepoPath.repoPath;
		if (GitRevision.isUncommittedStaged(commitOrRepoPath.sha) || !GitRevision.isUncommitted(commitOrRepoPath.sha)) {
			this.sha = commitOrRepoPath.sha;
		}
	}

	@memoize()
	get directory(): string {
		return relativeDir(this.relativePath);
	}

	@memoize()
	get fileName(): string {
		return basename(this.relativePath);
	}

	@memoize()
	get isUncommitted(): boolean {
		return GitRevision.isUncommitted(this.sha);
	}

	@memoize()
	get isUncommittedStaged(): boolean {
		return GitRevision.isUncommittedStaged(this.sha);
	}

	@memoize()
	get relativePath(): string {
		return splitPath(getBestPath(this.fsPath), this.repoPath)[0];
	}

	@memoize()
	get shortSha(): string {
		return GitRevision.shorten(this.sha);
	}

	@memoize()
	documentUri() {
		// TODO@eamodio which is correct?
		return Uri.from({
			scheme: this.scheme,
			authority: this.authority,
			path: this.path,
			query: this.query,
			fragment: this.fragment,
		});
		return Container.instance.git.getAbsoluteUri(this.fsPath, this.repoPath);
	}

	equals(uri: Uri | undefined) {
		if (!UriComparer.equals(this, uri)) return false;

		return this.sha === (GitUri.is(uri) ? uri.sha : undefined);
	}

	getFormattedFileName(options?: { suffix?: string; truncateTo?: number }): string {
		return formatPath(this.fsPath, { ...options, fileOnly: true });
	}

	@memoize()
	toFileUri() {
		return Container.instance.git.getAbsoluteUri(this.fsPath, this.repoPath);
	}

	static fromFile(file: string | GitFile, repoPath: string, ref?: string, original: boolean = false): GitUri {
		const uri = Container.instance.git.getAbsoluteUri(
			typeof file === 'string' ? file : (original && file.originalPath) || file.path,
			repoPath,
		);
		return !ref ? new GitUri(uri, repoPath) : new GitUri(uri, { repoPath: repoPath, sha: ref });
	}

	static fromRepoPath(repoPath: string, ref?: string) {
		return !ref
			? new GitUri(Container.instance.git.getAbsoluteUri(repoPath, repoPath), repoPath)
			: new GitUri(Container.instance.git.getAbsoluteUri(repoPath, repoPath), { repoPath: repoPath, sha: ref });
	}

	static fromRevisionUri(uri: Uri): GitUri {
		return new GitUri(uri);
	}

	@debug({
		exit: uri => `returned ${Logger.toLoggable(uri)}`,
	})
	static async fromUri(uri: Uri): Promise<GitUri> {
		if (GitUri.is(uri)) return uri;
		if (!Container.instance.git.isTrackable(uri)) return new GitUri(uri);
		if (uri.scheme === Schemes.GitLens) return new GitUri(uri);

		// If this is a git uri, find its repoPath
		if (uri.scheme === Schemes.Git) {
			let data: { path: string; ref: string } | undefined;
			try {
				data = JSON.parse(uri.query);
			} catch {}

			if (data?.path) {
				const repository = await Container.instance.git.getOrOpenRepository(Uri.file(data.path));
				if (repository == null) {
					debugger;
					throw new Error(`Unable to find repository for uri=${uri.toString(false)}`);
				}

				let ref;
				switch (data.ref) {
					case '':
					case '~':
						ref = GitRevision.uncommittedStaged;
						break;

					case null:
						ref = undefined;
						break;

					default:
						ref = data.ref;
						break;
				}

				const commitish: GitCommitish = {
					fileName: data.path,
					repoPath: repository?.path,
					sha: ref,
				};
				return new GitUri(uri, commitish);
			}
		}

		if (uri.scheme === Schemes.PRs) {
			let data:
				| {
						baseCommit: string;
						headCommit: string;
						isBase: boolean;
						fileName: string;
						prNumber: number;
						status: number;
						remoteName: string;
				  }
				| undefined;
			try {
				data = JSON.parse(uri.query);
			} catch {}

			if (data?.fileName) {
				const repository = await Container.instance.git.getOrOpenRepository(Uri.file(data.fileName));
				if (repository == null) {
					debugger;
					throw new Error(`Unable to find repository for uri=${uri.toString(false)}`);
				}

				let repoPath = normalizePath(uri.fsPath);
				if (repoPath.endsWith(data.fileName)) {
					repoPath = repoPath.substr(0, repoPath.length - data.fileName.length - 1);
				} else {
					// eslint-disable-next-line @typescript-eslint/no-non-null-asserted-optional-chain
					repoPath = (await Container.instance.git.getOrOpenRepository(uri))?.path!;
					if (!repoPath) {
						debugger;
					}
				}

				const commitish: GitCommitish = {
					fileName: data.fileName,
					repoPath: repoPath,
					sha: data.isBase ? data.baseCommit : data.headCommit,
				};
				return new GitUri(uri, commitish);
			}
		}

		const repository = await Container.instance.git.getOrOpenRepository(uri);
		return new GitUri(uri, repository?.path);
	}
}

export function decodeGitLensRevisionUriAuthority<T>(authority: string): T {
	return JSON.parse(decodeUtf8Hex(authority)) as T;
}

export function encodeGitLensRevisionUriAuthority<T>(metadata: T): string {
	return encodeUtf8Hex(JSON.stringify(metadata));
}

function decodeRemoteHubAuthority<T>(uri: Uri): { scheme: string; metadata: T | undefined } {
	const [scheme, encoded] = uri.authority.split('+');

	let metadata: T | undefined;
	if (encoded) {
		try {
			const data = JSON.parse(decodeUtf8Hex(encoded));
			metadata = data as T;
		} catch {}
	}

	return { scheme: scheme, metadata: metadata };
}
