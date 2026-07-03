import { todosWorkspace } from './todos';

export function openTodosBrowser() {
	const workspace = todosWorkspace.connect(null);
	return {
		...workspace,
		whenReady: workspace.storage.whenLoaded,
	};
}

export type TodosBrowser = ReturnType<typeof openTodosBrowser>;
