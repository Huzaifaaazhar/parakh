import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

@Component({
  selector: 'app-skeleton-grid',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4" aria-busy="true" aria-label="Loading">
      @for (i of slots(); track i) {
        <div class="card overflow-hidden">
          <div class="aspect-[4/5] animate-pulse bg-line/60"></div>
          <div class="space-y-2 p-3">
            <div class="h-3 w-1/3 animate-pulse rounded bg-line/70"></div>
            <div class="h-3 w-4/5 animate-pulse rounded bg-line/70"></div>
            <div class="h-4 w-1/2 animate-pulse rounded bg-line/70"></div>
          </div>
        </div>
      }
    </div>
  `,
})
export class SkeletonGrid {
  readonly count = input(8);
  protected slots = () => Array.from({ length: this.count() }, (_, i) => i);
}

@Component({
  selector: 'app-empty-state',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="card flex flex-col items-center gap-3 px-6 py-12 text-center">
      <p class="font-display text-xl font-semibold">{{ title() }}</p>
      @if (message()) {
        <p class="max-w-md text-sm text-muted">{{ message() }}</p>
      }
      @if (actionLabel()) {
        <button type="button" class="btn-ghost" (click)="action.emit()">{{ actionLabel() }}</button>
      }
    </div>
  `,
})
export class EmptyState {
  readonly title = input.required<string>();
  readonly message = input<string>('');
  readonly actionLabel = input<string>('');
  readonly action = output<void>();
}
