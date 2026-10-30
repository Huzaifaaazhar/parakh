import { ChangeDetectionStrategy, Component, effect, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { catchError, of } from 'rxjs';

import { ApiService } from '../core/api.service';
import { CompareTrayService } from '../core/compare-tray.service';
import { SideBySideResponse } from '../core/models';
import { ProductImage } from '../shared/product-image';
import { EmptyState } from '../shared/states';

@Component({
  selector: 'app-compare',
  imports: [RouterLink, ProductImage, EmptyState],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="mx-auto max-w-7xl px-4 py-8">
      <header class="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 class="text-3xl font-semibold sm:text-4xl">Side-by-side comparison</h1>
          <p class="mt-1 text-sm text-muted">Compare up to four products from any store — clothes, phones, anything.</p>
        </div>
        @if (tray.count()) {
          <button type="button" class="btn-ghost" (click)="tray.clear()">Clear all</button>
        }
      </header>

      @if (tray.count() < 2) {
        <app-empty-state
          title="Pick at least two products"
          message="Use “+ Compare” on any product card to add it here. Mix stores freely — that's the point."
          actionLabel="Browse products"
          (action)="goBrowse()"
        />
      } @else if (error()) {
        <app-empty-state title="Couldn't compare these" message="One of the products may no longer be available." />
      } @else if (data(); as d) {
        <p class="mb-5 rounded-xl bg-teal-soft px-4 py-3 text-sm text-teal">{{ d.summary }}</p>
        <div class="overflow-x-auto rounded-2xl border border-line bg-card">
          <table class="w-full min-w-[640px] table-fixed text-sm">
            <caption class="sr-only">
              Product comparison
            </caption>
            <thead>
              <tr>
                <th scope="col" class="w-36 p-4 text-left align-bottom text-xs font-semibold uppercase tracking-wider text-muted">Product</th>
                @for (p of d.products; track p.id) {
                  <th scope="col" class="p-4 text-left align-top font-normal">
                    <div class="relative">
                      <button
                        type="button"
                        class="absolute -right-1 -top-1 rounded-full bg-card px-1.5 text-muted hover:text-ink"
                        (click)="tray.remove(p.id)"
                        [attr.aria-label]="'Remove ' + p.product_name"
                      >
                        ✕
                      </button>
                      <a [routerLink]="['/products', p.id]" class="block aspect-square overflow-hidden rounded-xl bg-paper">
                        <app-product-image [src]="p.image_url" [vertical]="p.vertical" />
                      </a>
                      <a [routerLink]="['/products', p.id]" class="mt-2 line-clamp-2 font-medium hover:underline">{{ p.product_name }}</a>
                    </div>
                  </th>
                }
              </tr>
            </thead>
            <tbody class="divide-y divide-line">
              @for (row of d.rows; track row.attribute) {
                <tr>
                  <th scope="row" class="p-4 text-left font-medium text-muted">{{ row.attribute }}</th>
                  @for (v of row.values; track $index) {
                    <td class="p-4 capitalize" [class.font-semibold]="row.best_index === $index" [class.text-drop]="row.best_index === $index">
                      {{ v ?? '—' }}
                      @if (row.best_index === $index) {
                        <span class="ml-1 rounded-full bg-drop/10 px-1.5 py-0.5 text-[10px] font-semibold normal-case">best</span>
                      }
                    </td>
                  }
                </tr>
              }
              <tr>
                <th scope="row" class="p-4"></th>
                @for (p of d.products; track p.id) {
                  <td class="p-4">
                    <a [href]="p.product_url" target="_blank" rel="noopener noreferrer" class="btn-primary w-full">Buy at {{ p.store_name }} ↗</a>
                  </td>
                }
              </tr>
            </tbody>
          </table>
        </div>
      } @else {
        <div class="h-96 animate-pulse rounded-2xl bg-line/50" aria-busy="true"></div>
      }
    </div>
  `,
})
export class ComparePage {
  private api = inject(ApiService);
  private router = inject(Router);
  protected readonly tray = inject(CompareTrayService);
  protected readonly data = signal<SideBySideResponse | null>(null);
  protected readonly error = signal(false);

  constructor() {
    effect(() => {
      const ids = this.tray.items().map((p) => p.id);
      this.error.set(false);
      if (ids.length < 2) return;
      this.api
        .sideBySide(ids)
        .pipe(catchError(() => (this.error.set(true), of(null))))
        .subscribe((d) => this.data.set(d));
    });
  }

  goBrowse(): void {
    this.router.navigate(['/products']);
  }
}
