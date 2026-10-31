/**
 * Parakh motion toolkit. Everything is driven by scroll, touch or an element entering view;
 * nothing autoplays. One IntersectionObserver and one rAF scroll loop serve the whole app,
 * and only transform/opacity (plus CSS variables feeding them) change per frame.
 * With prefers-reduced-motion every effect jumps straight to its end state.
 */
import {
  ChangeDetectionStrategy,
  Component,
  Directive,
  ElementRef,
  Injectable,
  NgZone,
  OnDestroy,
  OnInit,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';

@Injectable({ providedIn: 'root' })
export class Motion {
  private zone = inject(NgZone);
  readonly reduced = signal(typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches);
  /** True while the home hero's ink field sits behind the header (header goes transparent). */
  readonly overInk = signal(false);

  // ---- in view (one shared observer) --------------------------------------------------------
  private callbacks = new WeakMap<Element, () => void>();
  private observer =
    typeof IntersectionObserver !== 'undefined'
      ? new IntersectionObserver(
          (entries) => {
            for (const e of entries) {
              if (!e.isIntersecting) continue;
              this.observer?.unobserve(e.target);
              const cb = this.callbacks.get(e.target);
              this.callbacks.delete(e.target);
              cb?.();
            }
          },
          { rootMargin: '0px 0px -8% 0px', threshold: 0.12 },
        )
      : null;

  /** Run `cb` once, the first time `el` enters the viewport. */
  onceInView(el: Element, cb: () => void): () => void {
    if (this.reduced() || !this.observer) {
      cb();
      return () => undefined;
    }
    this.callbacks.set(el, cb);
    this.observer.observe(el);
    return () => {
      this.observer?.unobserve(el);
      this.callbacks.delete(el);
    };
  }

  // ---- scroll loop (one passive listener, one rAF) ----------------------------------------------
  private subscribers = new Set<(y: number, dy: number) => void>();
  private lastY = 0;
  private ticking = false;
  private listening = false;

  onScroll(fn: (y: number, dy: number) => void): () => void {
    this.subscribers.add(fn);
    if (!this.listening && typeof window !== 'undefined') {
      this.listening = true;
      this.lastY = window.scrollY;
      this.zone.runOutsideAngular(() =>
        window.addEventListener(
          'scroll',
          () => {
            if (this.ticking) return;
            this.ticking = true;
            requestAnimationFrame(() => this.flush());
          },
          { passive: true },
        ),
      );
    }
    queueMicrotask(() => fn(window.scrollY, 0));
    return () => this.subscribers.delete(fn);
  }

  private flush(): void {
    this.ticking = false;
    const y = window.scrollY;
    const dy = y - this.lastY;
    this.lastY = y;
    for (const fn of this.subscribers) fn(y, dy);
  }
}

/** Adds `.is-in` the first time the element enters view; `--i` staggers siblings. */
@Directive({ selector: '[appReveal]', host: { class: 'pk-reveal', '[style.--i]': 'index()' } })
export class Reveal implements OnInit, OnDestroy {
  readonly index = input(0, { alias: 'appReveal', transform: (v: unknown) => Number(v) || 0 });
  private el = inject(ElementRef<HTMLElement>);
  private motion = inject(Motion);
  private stop?: () => void;

  ngOnInit(): void {
    this.stop = this.motion.onceInView(this.el.nativeElement, () => this.el.nativeElement.classList.add('is-in'));
  }
  ngOnDestroy(): void {
    this.stop?.();
  }
}

/** Counts a number up from zero, receipt-printer style, when it enters view. */
@Directive({ selector: '[appCountUp]' })
export class CountUp implements OnInit, OnDestroy {
  readonly to = input.required<number>({ alias: 'appCountUp' });
  readonly suffix = input('');
  private el = inject(ElementRef<HTMLElement>);
  private motion = inject(Motion);
  private zone = inject(NgZone);
  private stop?: () => void;
  private fmt = new Intl.NumberFormat('en-PK', { maximumFractionDigits: 0 });

  ngOnInit(): void {
    const node = this.el.nativeElement;
    node.textContent = this.fmt.format(0) + this.suffix();
    this.stop = this.motion.onceInView(node, () => this.run());
  }

  private run(): void {
    const node = this.el.nativeElement;
    const target = this.to();
    if (this.motion.reduced()) {
      node.textContent = this.fmt.format(target) + this.suffix();
      return;
    }
    const duration = 900;
    const start = performance.now();
    this.zone.runOutsideAngular(() => {
      const step = (now: number) => {
        const t = Math.min(1, (now - start) / duration);
        const eased = 1 - Math.pow(1 - t, 3);
        node.textContent = this.fmt.format(target * eased) + this.suffix();
        if (t < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  }

  ngOnDestroy(): void {
    this.stop?.();
  }
}

/** Tilts the element a few degrees toward the pointer or finger; springs back on release. */
@Directive({ selector: '[appTilt]', host: { class: 'pk-tilt' } })
export class Tilt implements OnInit, OnDestroy {
  private el = inject(ElementRef<HTMLElement>);
  private motion = inject(Motion);
  private zone = inject(NgZone);
  private frame = 0;
  private cleanup: (() => void)[] = [];

  ngOnInit(): void {
    if (this.motion.reduced()) return;
    const node = this.el.nativeElement;
    const set = (e: PointerEvent) => {
      if (e.pointerType === 'touch' && e.type === 'pointermove' && !node.classList.contains('is-pressed')) return;
      cancelAnimationFrame(this.frame);
      this.frame = requestAnimationFrame(() => {
        const r = node.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width - 0.5;
        const y = (e.clientY - r.top) / r.height - 0.5;
        node.style.setProperty('--ry', `${(x * 7).toFixed(2)}deg`);
        node.style.setProperty('--rx', `${(-y * 7).toFixed(2)}deg`);
      });
    };
    const down = (e: PointerEvent) => {
      node.classList.add('is-pressed');
      set(e);
    };
    const reset = () => {
      cancelAnimationFrame(this.frame);
      node.classList.remove('is-pressed');
      node.style.setProperty('--rx', '0deg');
      node.style.setProperty('--ry', '0deg');
    };
    this.zone.runOutsideAngular(() => {
      const opts = { passive: true } as const;
      node.addEventListener('pointermove', set, opts);
      node.addEventListener('pointerdown', down, opts);
      for (const ev of ['pointerleave', 'pointerup', 'pointercancel'] as const) node.addEventListener(ev, reset, opts);
      this.cleanup.push(() => {
        node.removeEventListener('pointermove', set);
        node.removeEventListener('pointerdown', down);
        for (const ev of ['pointerleave', 'pointerup', 'pointercancel'] as const) node.removeEventListener(ev, reset);
      });
    });
  }

  ngOnDestroy(): void {
    cancelAnimationFrame(this.frame);
    this.cleanup.forEach((fn) => fn());
  }
}

/**
 * Stacked-paper depth: sets `--sp` from 0 (sheet just entering at the bottom) to 1 (sheet has
 * settled near the top), so CSS can slide each sheet up over the previous one.
 */
@Directive({ selector: '[appParallax]', host: { class: 'pk-slip' } })
export class Parallax implements OnInit, OnDestroy {
  private el = inject(ElementRef<HTMLElement>);
  private motion = inject(Motion);
  private stop?: () => void;

  ngOnInit(): void {
    const node = this.el.nativeElement;
    if (this.motion.reduced()) {
      node.style.setProperty('--sp', '1');
      return;
    }
    let last = -1;
    this.stop = this.motion.onScroll(() => {
      const top = node.getBoundingClientRect().top;
      const vh = window.innerHeight;
      const p = Math.min(1, Math.max(0, (vh - top) / (vh * 0.55)));
      const rounded = Math.round(p * 100) / 100;
      if (rounded !== last) {
        last = rounded;
        node.style.setProperty('--sp', String(rounded));
      }
    });
  }
  ngOnDestroy(): void {
    this.stop?.();
  }
}

/** A price whose digits roll into place like a till odometer when it enters view. */
@Component({
  selector: 'app-odometer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'pk-odo', '[class.is-in]': 'rolled()', '[attr.aria-label]': 'text()', role: 'text' },
  template: `
    @for (ch of chars(); track $index) {
      @if (ch.digit !== null) {
        <span class="pk-odo__col" aria-hidden="true" [style.--d]="rolled() ? ch.digit : 0" [style.--c]="$index">
          <span class="pk-odo__strip">0<br />1<br />2<br />3<br />4<br />5<br />6<br />7<br />8<br />9</span>
        </span>
      } @else {
        <span aria-hidden="true">{{ ch.char }}</span>
      }
    }
  `,
})
export class Odometer implements OnInit, OnDestroy {
  readonly value = input.required<number>();
  private el = inject(ElementRef<HTMLElement>);
  private motion = inject(Motion);
  private stop?: () => void;
  protected readonly rolled = signal(false);
  private fmt = new Intl.NumberFormat('en-PK', { maximumFractionDigits: 0 });
  protected readonly text = computed(() => `Rs ${this.fmt.format(this.value())}`);
  protected readonly chars = computed(() => [...this.text()].map((c) => ({ char: c, digit: /\d/.test(c) ? Number(c) : null })));

  ngOnInit(): void {
    this.stop = this.motion.onceInView(this.el.nativeElement, () => this.rolled.set(true));
  }
  ngOnDestroy(): void {
    this.stop?.();
  }
}

export const MOTION = [Reveal, CountUp, Tilt, Parallax, Odometer] as const;
