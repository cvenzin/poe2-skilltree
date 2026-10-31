import { useStore, type AppState } from '../../state/store';

/** Store invalidation can publish a nested update before a scene's listener
 * runs. Diff against the last rendered state, never an intermediate notification. */
export function subscribeSceneState(render: (state: AppState, previous: AppState) => void): () => void {
  let rendered = useStore.getState();
  return useStore.subscribe(() => {
    const current = useStore.getState();
    if (current === rendered) return;
    const previous = rendered;
    rendered = current;
    render(current, previous);
  });
}
