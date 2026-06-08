import type { Task, Actor } from '../../core/Actor';
import { OperateDevice } from '../abilities/OperateDevice';

export class OpenSettingsRow implements Task {
  constructor(private label: string) {}

  static labeled(label: string): OpenSettingsRow {
    return new OpenSettingsRow(label);
  }

  async performAs(actor: Actor): Promise<void> {
    const { device } = actor.abilityTo<OperateDevice>('OperateDevice');
    await device.app.getByText(this.label).tap();
  }
}
