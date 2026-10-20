/** Compile-time regressions; tsc checks these functions without invoking them. */
import { Store, combineStores } from '@core/state/Store';
import { html, when } from '@core/utils/Template';

export function verifyStateTemplateContracts(condition: boolean, value: unknown): void {
  const combined = combineStores({ count: new Store({ value: 1 }), name: new Store({ value: 'a' }) });
  const count: number = combined.getState().count.value;
  const name: string = combined.getState().name.value;
  void count; void name;
  // @ts-expect-error A combined store retains the type of each source.
  const wrong: string = combined.getState().count.value;
  void wrong;
  // @ts-expect-error Source snapshots are readonly.
  combined.getState().count.value = 2;
  // @ts-expect-error Updates cannot substitute a different source domain.
  combined.setState({ name: { value: 2 } });
  combined.destroy();

  const conditional: number | '' = when(condition, 1);
  const explicitFallback: number | null = when(condition, 1, null);
  void conditional; void explicitFallback;
  // @ts-expect-error A conditional branch cannot erase the fallback type.
  const alwaysNumber: number = when(condition, 1, null);
  void alwaysNumber;
  void html`<div>${value}</div>`;
}
