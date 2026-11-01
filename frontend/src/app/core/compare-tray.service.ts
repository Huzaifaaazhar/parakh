import { Injectable, computed, effect, signal } from '@angular/core';

import { Product } from './models';

const MAX_ITEMS = 4;
const STORAGE_KEY = 'parakh.compare';

function restore(): Product[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.slice(0, MAX_ITEMS) : [];
  } catch {
    return [];
  }
}

/** Products the user picked for side-by-side comparison (any store, any category). */
@Injectable({ providedIn: 'root' })
export class CompareTrayService {
  readonly items = signal<Product[]>(restore());
  readonly count = computed(() => this.items().length);
  readonly isFull = computed(() => this.items().length >= MAX_ITEMS);

  constructor() {
    // keep picks across reloads so the Compare page in the menu still has them
    effect(() => {
      const list = this.items();
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
      } catch {
        /* storage blocked: tray still works for this visit */
      }
    });
  }

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
