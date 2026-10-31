import { ChangeDetectionStrategy, Component, ElementRef, NgZone, OnDestroy, afterNextRender, inject, input, signal, viewChild } from '@angular/core';

/**
 * Horizontal snap carousel: swipe on phones, arrow buttons on desktop, and a thin progress
 * rule (receipt-tape style) that tracks how far along the rail you are.
 */
@Component({
  selector: 'app-rail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pk-rail">
      <div #track class="pk-rail__track" [attr.aria-label]="label()" role="region" tabindex="0">
        <ng-content />
      </div>
      <button type="button" class="pk-rail__btn pk-rail__btn--prev" (click)="page(-1)" [disabled]="atStart()" aria-label="Scroll back">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
      </button>
      <button type="button" class="pk-rail__btn pk-rail__btn--next" (click)="page(1)" [disabled]="atEnd()" aria-label="Scroll forward">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square" aria-hidden="true"><path d="M9 5l7 7-7 7" /></svg>
      </button>
      <div class="pk-rail__progress" aria-hidden="true"><span #bar></span></div>
    </div>
  `,
})
export class Rail implements OnDestroy {
  readonly label = input('Carousel');
  private track = viewChild.required<ElementRef<HTMLElement>>('track');
  private bar = viewChild.required<ElementRef<HTMLElement>>('bar');
  private zone = inject(NgZone);
  protected readonly atStart = signal(true);
  protected readonly atEnd = signal(false);
  private frame = 0;
  private onScroll = () => {
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => this.measure());
  };
  private resize?: ResizeObserver;

  constructor() {
    afterNextRender(() => {
      const el = this.track().nativeElement;
      this.zone.runOutsideAngular(() => el.addEventListener('scroll', this.onScroll, { passive: true }));
      this.resize = new ResizeObserver(() => this.measure());
      this.resize.observe(el);
      this.measure();
    });
  }

  private measure(): void {
    const el = this.track().nativeElement;
    const max = el.scrollWidth - el.clientWidth;
    const p = max > 0 ? el.scrollLeft / max : 1;
    const visible = max > 0 ? el.clientWidth / el.scrollWidth : 1;
    // the bar shows the visible window sliding along the whole rail
    this.bar().nativeElement.style.transform = `translateX(${(p * (1 - visible) * 100) / visible}%) scaleX(1)`;
    this.bar().nativeElement.style.width = `${visible * 100}%`;
    const start = el.scrollLeft < 4;
    const end = el.scrollLeft > max - 4;
    if (start !== this.atStart()) this.zone.run(() => this.atStart.set(start));
    if (end !== this.atEnd()) this.zone.run(() => this.atEnd.set(end));
  }

  page(dir: 1 | -1): void {
    const el = this.track().nativeElement;
    el.scrollBy({ left: dir * el.clientWidth * 0.85, behavior: 'smooth' });
  }

  ngOnDestroy(): void {
    cancelAnimationFrame(this.frame);
    this.track().nativeElement.removeEventListener('scroll', this.onScroll);
    this.resize?.disconnect();
  }
}
