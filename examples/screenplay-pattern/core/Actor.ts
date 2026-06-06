export interface Task<T = void> {
  performAs(actor: Actor): Promise<T>;
}

export interface Question<T> {
  answeredBy(actor: Actor): Promise<T>;
}

export class Actor {
  private abilities: Map<string, any> = new Map();

  constructor(public readonly name: string) {}

  static named(name: string): Actor {
    return new Actor(name);
  }

  whoCan<T>(abilityName: string, ability: T): Actor {
    this.abilities.set(abilityName, ability);
    return this;
  }

  abilityTo<T>(abilityName: string): T {
    const ability = this.abilities.get(abilityName);
    if (!ability) {
      throw new Error(`Actor ${this.name} does not have the ability to ${abilityName}`);
    }
    return ability as T;
  }

  async attemptsTo<T>(...tasks: Task<any>[]): Promise<void> {
    for (const task of tasks) {
      await task.performAs(this);
    }
  }

  async asks<T>(question: Question<T>): Promise<T> {
    return await question.answeredBy(this);
  }
}
