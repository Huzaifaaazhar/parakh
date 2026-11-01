import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

export type HeroVariant = 'ink' | 'amber' | 'paper';

/**
 * Gradient page banner shared by every inner page: eyebrow, title, subtitle, a slot for
 * actions (search, chips, buttons) and an optional collage of real product photos laid
 * out like price-tagged prints.
 */
@Component({
  selector: 'app-page-hero',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <section class="pk-pagehero" [class]="'pk-pagehero--' + variant()" [class.pk-on-sage]="variant() === 'ink'">
      @if (variant() === 'ink') {
        <div class="pk-ink pk-ink--fold" aria-hidden="true"></div>
        <div class="pk-ink pk-ink--seam" aria-hidden="true"></div>
        <div class="pk-ink pk-ink--glow" aria-hidden="true"></div>
      }
      <div class="relative z-[2] mx-auto grid max-w-7xl items-center gap-6 px-4 pb-10 pt-8 sm:pb-14 sm:pt-12" [class.pk-split]="images().length">
        <div class="pk-pagehero__copy min-w-0">
          @if (eyebrow()) {
            <p class="t-label pk-pagehero__eyebrow">{{ eyebrow() }}</p>
          }
          <h1 class="pk-pagehero__title">{{ title() }}</h1>
          @if (subtitle()) {
            <p class="pk-pagehero__sub">{{ subtitle() }}</p>
          }
          <div class="mt-5 empty:hidden"><ng-content /></div>
        </div>
        @if (images().length) {
          <div class="pk-pagehero__visual relative hidden h-[230px] lg:block" aria-hidden="true">
            @for (src of shown(); track $index; let i = $index) {
              <div class="pk-print-photo" [style]="spot(i)"><img [src]="src" alt="" /></div>
            }
          </div>
        }
      </div>
    </section>
  `,
})
export class PageHero {
  readonly variant = input<HeroVariant>('paper');
  readonly eyebrow = input('');
  readonly title = input.required<string>();
  readonly subtitle = input('');
  readonly images = input<(string | null)[]>([]);
  protected readonly shown = computed(() => this.images().filter((s): s is string => !!s).slice(0, 3));

  spot(i: number): string {
    return [
      'left:6%;top:6%;width:34%;height:86%;transform:rotate(-5deg)',
      'left:36%;top:0;width:32%;height:80%;transform:rotate(3deg);z-index:2',
      'left:64%;top:10%;width:32%;height:84%;transform:rotate(-2deg);z-index:3',
    ][i];
  }
}
