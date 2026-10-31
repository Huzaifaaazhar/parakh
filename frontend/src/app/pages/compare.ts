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
    <div class="mx-auto max-w-7xl px-4 pb-16 pt-6 sm:pt-10">
      <div class="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 class="t-display-lg">Compare</h1>
          <p class="t-small mt-2">Up to four products from any store. The best figure in each row is marked.</p>
        </div>
        @if (tray.count()) {
          <button type="button" class="pk-link" (click)="tray.clear()">Clear all</button>
        }
      </div>

      @if (tray.count() < 2) {
        <app-empty-state
          title="Pick at least two products"
          message="Tick “Compare” on any product card to add it here. Mix stores and brands freely."
          actionLabel="Browse products"
          (action)="router.navigate(['/products'])"
        />
      } @else if (error()) {
        <app-empty-state title="We couldn't compare these" message="One of the products may no longer be listed." />
      } @else if (data(); as d) {
        <p class="mb-5 border-l-0 bg-bubblegum-soft px-4 py-3 text-[15px] text-charcoal">{{ d.summary }}</p>
        <div class="overflow-x-auto rounded-tag border border-line bg-paper-raised">
          <table class="w-full min-w-[620px] table-fixed border-collapse text-[15px]">
            <caption class="sr-only">Side-by-side product comparison</caption>
            <thead class="sticky top-14 z-10 bg-paper-raised">
              <tr class="border-b-2 border-blue">
                <th scope="col" class="w-32 p-3 text-left align-bottom"><span class="t-label text-charcoal-muted">Product</span></th>
                @for (p of d.products; track p.id) {
                  <th scope="col" class="p-3 text-left align-top font-normal">
                    <div class="relative">
                      <a [routerLink]="['/products', p.id]" class="block aspect-square overflow-hidden rounded-tag border border-line" [style.view-transition-name]="'product-' + p.id">
                        <app-product-image [src]="p.image_url" [label]="p.store_name || p.brand_name" />
                      </a>
                      <button
                        type="button"
                        class="absolute right-1 top-1 grid h-9 w-9 place-items-center rounded-tag bg-paper-raised text-blue"
                        (click)="tray.remove(p.id)"
                        [attr.aria-label]="'Remove ' + p.product_name"
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="square" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
                      </button>
                      <a [routerLink]="['/products', p.id]" class="t-title mt-2 line-clamp-2 hover:underline">{{ p.product_name }}</a>
                    </div>
                  </th>
                }
              </tr>
            </thead>
            <tbody>
              @for (row of d.rows; track row.attribute) {
                <tr class="border-b border-line hover:bg-blue-tint">
                  <th scope="row" class="p-3 text-left align-top"><span class="t-label text-charcoal-muted">{{ row.attribute }}</span></th>
                  @for (v of row.values; track $index) {
                    <td class="p-3 align-top" [class.font-mono]="isNumeric(row.attribute)" [class.capitalize]="!isNumeric(row.attribute)">
                      @if (row.best_index === $index) {
                        <span class="border-b-2 border-bubblegum font-semibold text-pink-ink">{{ v }}</span>
                        <span class="sr-only">(best)</span>
                      } @else {
                        <span [class.text-blue]="isNumeric(row.attribute)">{{ v ?? '—' }}</span>
                      }
                    </td>
                  }
                </tr>
              }
              <tr>
                <th scope="row" class="p-3"></th>
                @for (p of d.products; track p.id) {
                  <td class="p-3"><a [href]="p.product_url" target="_blank" rel="noopener noreferrer" class="pk-btn pk-btn--primary pk-btn--sm w-full">Go to {{ p.store_name }}</a></td>
                }
              </tr>
            </tbody>
          </table>
        </div>
      } @else {
        <div class="pk-skel h-96" aria-busy="true"></div>
      }
    </div>
  `,
})
export class ComparePage {
  private api = inject(ApiService);
  protected readonly router = inject(Router);
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

  isNumeric(attribute: string): boolean {
    return /price|discount|mah|ram|storage|inches|wattage|ml/i.test(attribute);
  }
}
