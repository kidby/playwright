import type { Question, Actor } from '../../core/Actor';
import { OperateDevice } from '../abilities/OperateDevice';

export class SettingsState {
  static hasRow(label: string): Question<boolean> {
    return {
      answeredBy: async (actor: Actor) => {
        const { device } = actor.abilityTo<OperateDevice>('OperateDevice');
        return await device.app.getByText(label).isVisible();
      },
    };
  }
}
