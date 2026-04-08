export class AsyncQueue<T> implements AsyncIterable<T> {
  readonly #values: T[] = [];
  readonly #resolvers: Array<(result: IteratorResult<T>) => void> = [];
  #closed = false;
  #error: unknown;

  push(value: T): void {
    if (this.#closed) {
      return;
    }
    const resolver = this.#resolvers.shift();
    if (resolver) {
      resolver({ value, done: false });
      return;
    }
    this.#values.push(value);
  }

  close(): void {
    this.#closed = true;
    while (this.#resolvers.length > 0) {
      this.#resolvers.shift()?.({ value: undefined, done: true });
    }
  }

  fail(error: unknown): void {
    this.#error = error;
    this.close();
  }

  async next(): Promise<IteratorResult<T>> {
    if (this.#values.length > 0) {
      const value = this.#values.shift() as T;
      return { value, done: false };
    }
    if (this.#error) {
      throw this.#error instanceof Error ? this.#error : new Error('async queue failed');
    }
    if (this.#closed) {
      return { value: undefined, done: true };
    }
    return new Promise((resolve) => {
      this.#resolvers.push(resolve);
    });
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => this.next(),
    };
  }
}
