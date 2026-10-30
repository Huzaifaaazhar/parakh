import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';

const TINTS: Record<string, string> = {
  fashion: 'from-saffron-soft to-[#f6dcc0]',
  electronics: 'from-teal-soft to-[#cfe3e0]',
  beauty: 'from-[#fbe6ea] to-[#f4d2d9]',
  home: 'from-[#ece8f6] to-[#dcd6ee]',
};

const ICONS: Record<string, string> = {
  fashion: 'M8 4l4 2 4-2 4 3-2 4h-2v9H8v-9H6L4 7z',
  electronics: 'M7 3h10a1 1 0 011 1v16a1 1 0 01-1 1H7a1 1 0 01-1-1V4a1 1 0 011-1zm4 15h2',
  beauty: 'M10 3h4v4h-4zM8 7h8l1 14H7z',
  home: 'M3 11l9-7 9 7v9a1 1 0 01-1 1h-5v-6h-6v6H4a1 1 0 01-1-1z',
};

/** Product photo with a graceful, category-tinted placeholder when there's no image or it fails to load. */
@Component({
  selector: 'app-product-image',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (src() && !failed()) {
      <img
        [src]="src()"
        [alt]="alt()"
        loading="lazy"
        decoding="async"
        (error)="failed.set(true)"
        class="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
      />
    } @else {
      <div class="flex h-full w-full flex-col items-center justify-center gap-2 bg-gradient-to-br p-4 text-center {{ tint() }}">
        <svg viewBox="0 0 24 24" class="h-10 w-10 text-ink/40" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true">
          <path [attr.d]="icon()" />
        </svg>
        <span class="line-clamp-2 text-[11px] font-medium uppercase tracking-wider text-ink/50">{{ label() }}</span>
      </div>
    }
  `,
  host: { class: 'block h-full w-full overflow-hidden' },
})
export class ProductImage {
  readonly src = input<string | null>(null);
  readonly alt = input('');
  readonly vertical = input<string>('fashion');
  readonly label = input('');
  readonly failed = signal(false);
  readonly tint = computed(() => TINTS[this.vertical()] ?? TINTS['fashion']);
  readonly icon = computed(() => ICONS[this.vertical()] ?? ICONS['fashion']);
}
