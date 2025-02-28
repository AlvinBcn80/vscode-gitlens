import { Disposable, TextEditor, Uri, window } from 'vscode';
import { Container } from '../container';
import { Repository } from '../git/models';
import { map } from '../system/iterable';
import { getQuickPickIgnoreFocusOut } from '../system/utils';
import { CommandQuickPickItem } from './items/common';
import { RepositoryQuickPickItem } from './items/gitCommands';

export namespace RepositoryPicker {
	export async function getBestRepositoryOrShow(
		uri: Uri | undefined,
		editor: TextEditor | undefined,
		title: string,
	): Promise<Repository | undefined> {
		const repository = Container.instance.git.getBestRepository(uri, editor);
		if (repository != null) return repository;

		const pick = await RepositoryPicker.show(title);
		if (pick instanceof CommandQuickPickItem) {
			await pick.execute();
			return undefined;
		}

		return pick?.item;
	}

	export async function getRepositoryOrShow(title: string, uri?: Uri): Promise<Repository | undefined> {
		if (uri == null) return Container.instance.git.highlander;

		const repository = await Container.instance.git.getOrOpenRepository(uri);
		if (repository != null) return repository;

		const pick = await RepositoryPicker.show(title);
		if (pick instanceof CommandQuickPickItem) {
			void (await pick.execute());
			return undefined;
		}

		return pick?.item;
	}

	export async function show(
		title: string | undefined,
		placeholder: string = 'Choose a repository',
		repositories?: Repository[],
	): Promise<RepositoryQuickPickItem | undefined> {
		const items: RepositoryQuickPickItem[] = await Promise.all([
			...map(repositories ?? Container.instance.git.openRepositories, r =>
				RepositoryQuickPickItem.create(r, undefined, { branch: true, status: true }),
			),
		]);

		const quickpick = window.createQuickPick<RepositoryQuickPickItem>();
		quickpick.ignoreFocusOut = getQuickPickIgnoreFocusOut();

		const disposables: Disposable[] = [];

		try {
			const pick = await new Promise<RepositoryQuickPickItem | undefined>(resolve => {
				disposables.push(
					quickpick.onDidHide(() => resolve(undefined)),
					quickpick.onDidAccept(() => {
						if (quickpick.activeItems.length !== 0) {
							resolve(quickpick.activeItems[0]);
						}
					}),
				);

				quickpick.title = title;
				quickpick.placeholder = placeholder;
				quickpick.matchOnDescription = true;
				quickpick.matchOnDetail = true;
				quickpick.items = items;

				quickpick.show();
			});
			if (pick == null) return undefined;

			return pick;
		} finally {
			quickpick.dispose();
			disposables.forEach(d => d.dispose());
		}
	}
}
