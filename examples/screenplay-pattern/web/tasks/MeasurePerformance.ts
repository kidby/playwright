import type { Task, Actor } from '../../core/Actor';
import { BrowseWeb } from '../abilities/BrowseWeb';
import { playAudit } from '@playwright/lighthouse';
import { playReport } from '@playwright/lighthouse/html-report';

export class MeasurePerformance implements Task {
  constructor(private url: string, private expectedScore: number) {}

  static ofUrl(url: string, expectedScore: number) {
    return new MeasurePerformance(url, expectedScore);
  }

  async performAs(actor: Actor): Promise<void> {
    const ability = actor.abilityTo<BrowseWeb>('BrowseWeb');
    const page = ability.page;

    await page.goto(this.url);

    const report = await playAudit({
      page: page,
      thresholds: {
        performance: this.expectedScore,
        accessibility: this.expectedScore,
        'best-practices': this.expectedScore,
        seo: this.expectedScore,
      },
      port: 9222,
    });

    await playReport(report, `screenplay-lighthouse-${actor.name}.html`);
  }
}
