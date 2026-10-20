import { inject, injectable } from 'tsyringe';
import { TOKENS } from '@core/di/tokens';
import type { AuthTokenService } from '@core/auth/AuthTokenService';
import { CustomListService, validListName, validListUser, type CustomListUser, type CustomLists } from './CustomListService';

/** One writer per device with isolated account and local lists. */
@injectable()
export class CustomListHost {
  private services = new Map<number | null, CustomListService>();
  private writes: Promise<unknown> = Promise.resolve();
  constructor(@inject(TOKENS.AuthTokenService) private auth: AuthTokenService) {}
  private service(owner: number | null): CustomListService {
    let service = this.services.get(owner);
    if (!service) {
      service = new CustomListService(`custom_lists_account_${owner ?? 'local'}`);
      this.services.set(owner, service);
    }
    return service;
  }
  dispatch(operation: unknown, value: unknown, session: unknown): Promise<CustomLists> {
    if (!['get', 'toggle', 'create', 'delete'].includes(operation as string)) return Promise.reject(new Error('Unknown lists command'));
    const copy = structuredClone(value);
    const pending = this.writes.then(async () => {
      await this.auth.ensureInitialized();
      const owner = this.auth.hasToken() ? this.auth.getUserCache()?.userId ?? null : null;
      const assertSession = () => {
        if (typeof session !== 'string' || session !== this.auth.getSessionId()) throw new Error('Lists account changed');
      };
      assertSession();
      const service = this.service(owner);
      await service.init();
      assertSession();
      const args = copy && typeof copy === 'object' ? copy as Record<string, unknown> : {};
      if (operation === 'get') return service.getLists();
      if (operation === 'toggle') {
        if (!validListName(args.name as string) || !validListUser(args.user) || typeof args.active !== 'boolean') throw new Error('Invalid membership command');
        await service.toggleUserInList(args.name as string, args.user as CustomListUser, args.active);
      } else if (operation === 'create' || operation === 'delete') {
        if (!validListName(args.name as string)) throw new Error('Invalid list command');
        if (operation === 'create') await service.createList(args.name as string);
        else await service.deleteList(args.name as string);
      } else throw new Error('Unknown lists command');
      assertSession();
      return service.getLists();
    });
    this.writes = pending.catch(() => undefined);
    return pending;
  }
}
