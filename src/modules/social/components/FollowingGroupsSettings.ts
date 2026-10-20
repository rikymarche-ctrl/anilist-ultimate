import { BaseComponent } from '@ui/components/BaseComponent';
import { html } from '@core/utils/Template';
import { logger } from '@core/logger';
import type { ToastService } from '@core/services/ToastService';
import type { FollowingGroupsService } from '../FollowingGroupsService';

interface SettingsProps {
  listNames: string[];
}

/**
 * Overview block of the custom lists settings: chooses and orders the lists that group the
 * Following column on a title's Social tab. Display preference only; nothing is sent to AniList.
 */
export class FollowingGroupsSettings extends BaseComponent<SettingsProps> {
  private unsubscribe: (() => void) | null = null;
  private focusMove: { name: string; direction: -1 | 1 } | null = null;

  constructor(
    private readonly groups: FollowingGroupsService,
    private readonly toast: ToastService,
    listNames: string[]
  ) {
    super({ listNames });
  }

  protected render(): HTMLElement {
    return html`<section class="au-fg-settings" aria-labelledby="au-fg-title"></section>`;
  }

  protected override onMount(): void {
    this.unsubscribe = this.groups.onChange(() => this.refresh());
    this.refresh();
    this.groups
      .init()
      .then(() => this.refresh())
      .catch((error: unknown) =>
        logger.warn('[FollowingGroupsSettings] Groups unavailable', error)
      );
  }

  protected override attachEvents(): void {
    this.addEventListener(this.element, 'change', (event: Event) => this.handleToggle(event));
    this.addEventListener(this.element, 'click', (event: Event) => this.handleMove(event));
  }

  protected override onUnmount(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.focusMove = null;
  }

  /** Enabled groups first in configured order, then the remaining existing lists. Stale config names are hidden. */
  private refresh(): void {
    if (!this.mounted) return;
    const names = this.props.listNames;
    const enabled = this.groups.getConfig().groups.filter((name) => names.includes(name));
    const disabled = names.filter((name) => !enabled.includes(name));
    this.element.replaceChildren(this.renderBody(enabled, disabled));
    this.restoreFocus();
  }

  private renderBody(enabled: string[], disabled: string[]): HTMLElement {
    const body = html`<div class="au-fg-body">
      <h4 class="au-fg-title" id="au-fg-title">Following groups</h4>
      <p class="au-fg-hint">
        Checked lists group the Following column on a title's Social tab, top to bottom. Everyone
        else goes to Others. Display only, nothing changes on AniList.
      </p>
      <ul class="au-fg-list"></ul>
      <p class="au-fg-others">Others — always last</p>
    </div>`;
    const list = body.querySelector<HTMLElement>('.au-fg-list')!;
    enabled.forEach((name, index) =>
      list.appendChild(this.renderRow(name, true, index, enabled.length))
    );
    disabled.forEach((name) => list.appendChild(this.renderRow(name, false, 0, 0)));
    return body;
  }

  private renderRow(name: string, enabled: boolean, position: number, total: number): HTMLElement {
    const row = html`<li class="au-fg-row">
      <label class="au-fg-label"
        ><input type="checkbox" class="au-fg-check" data-fg-toggle="${name}" /><span
          class="au-fg-name"
          >${name}</span
        ></label
      ><span class="au-fg-moves"></span>
    </li>`;
    row.querySelector<HTMLInputElement>('.au-fg-check')!.checked = enabled;
    if (enabled) {
      row
        .querySelector('.au-fg-moves')!
        .append(
          this.moveButton(name, -1, position === 0),
          this.moveButton(name, 1, position === total - 1)
        );
    }
    return row;
  }

  private moveButton(name: string, direction: -1 | 1, disabled: boolean): HTMLButtonElement {
    const button = html`<button
      type="button"
      class="au-fg-move"
      data-fg-move="${name}"
      data-dir="${String(direction)}"
    >
      ${direction < 0 ? '↑' : '↓'}
    </button>` as HTMLButtonElement;
    button.setAttribute('aria-label', `Move ${name} ${direction < 0 ? 'up' : 'down'}`);
    button.disabled = disabled;
    return button;
  }

  private handleToggle(event: Event): void {
    const input = event.target instanceof HTMLInputElement ? event.target : null;
    const name = input?.dataset.fgToggle;
    if (!input || name === undefined) return;
    this.save(this.groups.setGroupEnabled(name, input.checked));
  }

  private handleMove(event: Event): void {
    const button =
      event.target instanceof Element
        ? event.target.closest<HTMLButtonElement>('.au-fg-move')
        : null;
    const name = button?.dataset.fgMove;
    if (!button || name === undefined || button.disabled) return;
    const direction = Number(button.dataset.dir) < 0 ? -1 : 1;
    this.focusMove = { name, direction };
    this.save(this.groups.moveGroup(name, direction));
  }

  /** A failed write re-reads the stored config so the controls never show unsaved state. */
  private save(write: Promise<void>): void {
    write.catch((error: unknown) => {
      logger.error('[FollowingGroupsSettings] Failed to save following groups', error);
      this.toast.error('Failed to save following groups. Please retry.');
      this.refresh();
    });
  }

  /** Re-rendering replaces the buttons, so keyboard focus returns to the moved group's control. */
  private restoreFocus(): void {
    const target = this.focusMove;
    this.focusMove = null;
    if (!target) return;
    const buttons = [...this.element.querySelectorAll<HTMLButtonElement>('.au-fg-move')].filter(
      (button) => button.dataset.fgMove === target.name && !button.disabled
    );
    (
      buttons.find((button) => Number(button.dataset.dir) === target.direction) ?? buttons[0]
    )?.focus();
  }
}
