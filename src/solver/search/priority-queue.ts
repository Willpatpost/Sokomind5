/**
 * A deterministic binary min-heap.
 *
 * The caller supplies the semantic ordering. Entries that compare equally are
 * removed in insertion order, which keeps solver runs reproducible without
 * forcing every strategy to manufacture a final tie-break field.
 */
export class StablePriorityQueue<T> {
  readonly #compare: (left: T, right: T) => number;
  readonly #heap: Array<{
    readonly value: T;
    readonly sequence: number;
  }> = [];
  #nextSequence = 0;

  constructor(compare: (left: T, right: T) => number) {
    this.#compare = compare;
  }

  get size(): number {
    return this.#heap.length;
  }

  get empty(): boolean {
    return this.#heap.length === 0;
  }

  clear(): void {
    this.#heap.length = 0;
  }

  enqueue(value: T): void {
    const entry = {
      value,
      sequence: this.#nextSequence,
    };
    this.#nextSequence += 1;
    this.#heap.push(entry);
    this.#siftUp(this.#heap.length - 1);
  }

  peek(): T | undefined {
    return this.#heap[0]?.value;
  }

  dequeue(): T | undefined {
    const root = this.#heap[0];
    if (!root) return undefined;

    const tail = this.#heap.pop();
    if (tail && this.#heap.length > 0) {
      this.#heap[0] = tail;
      this.#siftDown(0);
    }
    return root.value;
  }

  #compareEntries(
    left: { readonly value: T; readonly sequence: number },
    right: { readonly value: T; readonly sequence: number },
  ): number {
    const compared = this.#compare(left.value, right.value);
    return compared === 0 ? left.sequence - right.sequence : compared;
  }

  #siftUp(startIndex: number): void {
    let index = startIndex;
    while (index > 0) {
      const parentIndex = (index - 1) >> 1;
      const entry = this.#heap[index];
      const parent = this.#heap[parentIndex];
      if (!entry || !parent || this.#compareEntries(entry, parent) >= 0) {
        return;
      }
      this.#heap[index] = parent;
      this.#heap[parentIndex] = entry;
      index = parentIndex;
    }
  }

  #siftDown(startIndex: number): void {
    let index = startIndex;
    for (;;) {
      const leftIndex = index * 2 + 1;
      const rightIndex = leftIndex + 1;
      let bestIndex = index;

      const best = this.#heap[bestIndex];
      const left = this.#heap[leftIndex];
      if (best && left && this.#compareEntries(left, best) < 0) {
        bestIndex = leftIndex;
      }

      const currentBest = this.#heap[bestIndex];
      const right = this.#heap[rightIndex];
      if (
        currentBest &&
        right &&
        this.#compareEntries(right, currentBest) < 0
      ) {
        bestIndex = rightIndex;
      }

      if (bestIndex === index) return;
      const entry = this.#heap[index];
      const replacement = this.#heap[bestIndex];
      if (!entry || !replacement) return;
      this.#heap[index] = replacement;
      this.#heap[bestIndex] = entry;
      index = bestIndex;
    }
  }
}

/** Lexicographic comparison for deterministic objective and heuristic tuples. */
export function compareNumberTuples(
  left: readonly number[],
  right: readonly number[],
): number {
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const leftValue = left[index] ?? Number.NEGATIVE_INFINITY;
    const rightValue = right[index] ?? Number.NEGATIVE_INFINITY;
    if (leftValue < rightValue) return -1;
    if (leftValue > rightValue) return 1;
  }
  return 0;
}
