import { Injectable, computed, signal } from '@angular/core';

import { Product } from './models';

const MAX_ITEMS = 4;

/** Products the user picked for side-by-side comparison (any store, any category). */
@Injectable({ providedIn: 'root' })
export class CompareTrayService {
  readonly items = signal<Product[]>([]);
  readonly count = computed(() => this.items().length);
  readonly isFull = computed(() => this.items().length >= MAX_ITEMS);

  has(id: number): boolean {
    return this.items().some((p) => p.id === id);
  }

  toggle(product: Product): void {
    if (this.has(product.id)) {
      this.remove(product.id);
    } else if (!this.isFull()) {
      this.items.update((list) => [...list, product]);
    }
  }

  remove(id: number): void {
    this.items.update((list) => list.filter((p) => p.id !== id));
  }

  clear(): void {
    this.items.set([]);
  }
}
