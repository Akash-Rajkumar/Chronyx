/**
 * Bounded Ring Buffer for Node History (P1-T3)
 * Holds a fixed maximum capacity (default: 3600 points = 1 hour at 1 Hz).
 * Maintains strict chronological order and prevents unbounded memory growth.
 */
export class RingBuffer<T> {
  private buffer: T[];
  private head: number = 0;
  private count: number = 0;
  private readonly capacity: number;

  constructor(capacity = 3600) {
    if (capacity <= 0) {
      throw new Error('RingBuffer capacity must be a positive integer.');
    }
    this.capacity = capacity;
    this.buffer = new Array<T>(capacity);
  }

  /**
   * Pushes a new item into the buffer.
   * If the buffer is full, the oldest item is overwritten.
   */
  push(item: T): void {
    const index = (this.head + this.count) % this.capacity;
    if (this.count < this.capacity) {
      this.buffer[index] = item;
      this.count++;
    } else {
      // Buffer is full: overwrite at head and advance head
      this.buffer[this.head] = item;
      this.head = (this.head + 1) % this.capacity;
    }
  }

  /**
   * Returns all items in chronological order (oldest to newest).
   */
  getAll(): T[] {
    const result: T[] = new Array<T>(this.count);
    for (let i = 0; i < this.count; i++) {
      result[i] = this.buffer[(this.head + i) % this.capacity]!;
    }
    return result;
  }

  /**
   * Returns the most recent N items in chronological order.
   */
  getRecent(n: number): T[] {
    const take = Math.min(n, this.count);
    if (take <= 0) return [];
    const result: T[] = new Array<T>(take);
    const startOffset = this.count - take;
    for (let i = 0; i < take; i++) {
      result[i] = this.buffer[(this.head + startOffset + i) % this.capacity]!;
    }
    return result;
  }

  /**
   * Current number of elements stored.
   */
  size(): number {
    return this.count;
  }

  /**
   * Maximum capacity of the buffer.
   */
  getCapacity(): number {
    return this.capacity;
  }

  /**
   * Clears the buffer.
   */
  clear(): void {
    this.buffer = new Array<T>(this.capacity);
    this.head = 0;
    this.count = 0;
  }
}
