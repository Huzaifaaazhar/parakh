import { ChangeDetectionStrategy, Component, input, signal } from '@angular/core';

/** Product photo; when it's missing or fails, a flat blue-tint tile with the store's initial (no gradients, no icons). */
@Component({
  selector: 'app-product-image',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (src() && !failed()) {
      <img [src]="src()" [alt]="alt()" loading="lazy" decoding="async" (error)="failed.set(true)" class="h-full w-full object-cover" />
    } @else {
      <div class="pk-ph" aria-hidden="true">{{ initial() }}</div>
    }
  `,
  host: { class: 'block h-full w-full overflow-hidden' },
})
export class ProductImage {
  readonly src = input<string | null>(null);
  readonly alt = input('');
  readonly label = input('');
  readonly failed = signal(false);
  protected initial = () => (this.label() || this.alt() || 'P').trim().charAt(0).toUpperCase();
}
