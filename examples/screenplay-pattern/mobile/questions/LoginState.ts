import type { Question, Actor } from '../../core/Actor';
import { OperateDevice } from '../abilities/OperateDevice';

export class LoginState {
  static isSuccessful(): Question<boolean> {
    return {
      answeredBy: async (actor: Actor) => {
        const ability = actor.abilityTo<OperateDevice>('OperateDevice');
        const device = ability.device;
        
        // Check if products header is visible using a cross-platform accessibility ID
        const header = device.locator('~Products');
        
        try {
          // Playwright locator wait wrapper
          await header.waitFor({ state: 'visible', timeout: 5000 });
          return true;
        } catch {
          return false;
        }
      }
    };
  }
}
