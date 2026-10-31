import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

/** Static skeleton blocks in the line colour: no shimmer, no pulse. */
@Component({
  selector: 'app-skeleton-grid',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-6 lg:grid-cols-4" aria-busy="true" aria-label="Loading">
      @for (i of slots(); track i) {
        <div class="overflow-hidden rounded-tag border border-line bg-paper-raised">
          <div class="pk-skel aspect-[4/5] rounded-none"></div>
          <div class="space-y-2 p-3">
            <div class="pk-skel h-3 w-1/3"></div>
            <div class="pk-skel h-3 w-4/5"></div>
            <div class="pk-skel h-4 w-1/2"></div>
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
    <div class="flex flex-col items-start gap-3 border-t-2 border-blue py-8">
      <p class="t-heading">{{ title() }}</p>
      @if (message()) {
        <p class="t-small max-w-md">{{ message() }}</p>
      }
      @if (actionLabel()) {
        <button type="button" class="pk-btn pk-btn--quiet pk-btn--sm" (click)="action.emit()">{{ actionLabel() }}</button>
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
