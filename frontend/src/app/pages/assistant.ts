import { ChangeDetectionStrategy, Component, ElementRef, inject, input, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { ApiService } from '../core/api.service';
import { ChatResponse, Product } from '../core/models';
import { DecimalPipe } from '@angular/common';
import { PkrPipe } from '../shared/format';
import { Reveal } from '../shared/motion';
import { PageHero } from '../shared/page-hero';
import { ProductImage } from '../shared/product-image';

interface Message {
  role: 'user' | 'assistant';
  text: string;
  products?: Product[];
  suggestions?: string[];
  usedLlm?: boolean;
  trace?: string[];
  error?: boolean;
}

const SESSION_KEY = 'parakh.chat.session';

function readSession(): string | null {
  try {
    return sessionStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
}

@Component({
  selector: 'app-assistant',
  imports: [FormsModule, RouterLink, PkrPipe, ProductImage, PageHero, Reveal, DecimalPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex h-[calc(100dvh-3.5rem)] flex-col">
      <div #scroller class="flex-1 overflow-y-auto" aria-live="polite">
        @if (!messages().length) {
          <app-page-hero
            variant="ink"
            eyebrow="Shopping assistant"
            title="Ask before you buy"
            subtitle="Ask in plain words. We search every store we track, compare similar items and point out the real deals."
          />
          <div class="mx-auto max-w-3xl px-4 py-8">
            @if (productId()) {
              <p class="mb-5 rounded-[8px] bg-gradient-to-r from-bubblegum-soft to-paper-raised px-4 py-3 text-[15px]">You came from a product page. Ask for cheaper alternatives to it.</p>
            }
            <p class="t-label mb-3 text-blue">Try one of these</p>
            <div class="grid gap-3 sm:grid-cols-2">
              @for (s of starters(); track s; let i = $index) {
                <button type="button" class="pk-starter" [appReveal]="i" (click)="send(s)">
                  <span>{{ s }}</span>
                  <span class="t-small">Ask Parakh</span>
                </button>
              }
            </div>
          </div>
        }

        <div class="mx-auto max-w-3xl space-y-5 px-4 py-6">
          @for (m of messages(); track $index) {
            @if (m.role === 'user') {
              <div class="pk-msg-in flex justify-end">
                <p class="pk-bubble-user max-w-[85%] px-4 py-3 text-[15px]">{{ m.text }}</p>
              </div>
            } @else {
              <div class="pk-msg-in flex gap-3">
                <span class="grid h-9 w-9 shrink-0 place-items-center rounded-[6px] bg-gradient-to-br from-blue to-blue-ink font-display text-[15px] font-extrabold text-bubblegum" aria-hidden="true">P</span>
                <div class="min-w-0 flex-1 space-y-3">
                  <div class="pk-bubble-bot whitespace-pre-line px-4 py-3 text-[15px] leading-relaxed" [class.text-pink-ink]="m.error">{{ m.text }}</div>
                  @if (m.products?.length) {
                    <div class="pk-strip -mx-1 px-1 pb-2">
                      @for (p of m.products; track p.id) {
                        <a [routerLink]="['/products', p.id]" class="pk-card w-40 shrink-0 overflow-hidden">
                          <div class="relative aspect-square overflow-hidden bg-paper">
                            <app-product-image [src]="p.image_url" [label]="p.store_name || p.brand_name" />
                            @if (p.discount_percentage > 0) {
                              <span class="pk-sticker absolute left-2 top-2 !h-6 !min-w-0 !text-[11px]">−{{ p.discount_percentage | number: '1.0-0' }}%</span>
                            }
                          </div>
                          <div class="flex flex-col gap-1 p-2.5">
                            <span class="pk-card__store truncate">{{ p.store_name }}</span>
                            <span class="line-clamp-2 text-[13px] font-semibold leading-snug">{{ p.product_name }}</span>
                            <span class="pk-price__now text-[15px]" [class.pk-price__now--sale]="p.discount_percentage > 0">{{ p.price | pkr }}</span>
                          </div>
                        </a>
                      }
                    </div>
                  }
                  @if (m.suggestions?.length && $last) {
                    <div class="flex flex-wrap gap-2">
                      @for (s of m.suggestions; track s) {
                        <button type="button" class="pk-chip" (click)="send(s)">{{ s }}</button>
                      }
                    </div>
                  }
                  @if (m.trace?.length) {
                    <details class="t-small">
                      <summary class="cursor-pointer select-none">How we answered ({{ m.usedLlm ? 'AI' : 'rules' }})</summary>
                      <ol class="t-receipt mt-1 list-decimal pl-5">
                        @for (t of m.trace; track $index) {
                          <li>{{ t }}</li>
                        }
                      </ol>
                    </details>
                  }
                </div>
              </div>
            }
          }
          @if (busy()) {
            <div class="pk-msg-in flex items-center gap-3" role="status">
              <span class="grid h-9 w-9 shrink-0 place-items-center rounded-[6px] bg-gradient-to-br from-blue to-blue-ink font-display text-[15px] font-extrabold text-bubblegum" aria-hidden="true">P</span>
              <span class="pk-bubble-bot pk-typing px-4 py-3"><span></span><span></span><span></span><span class="sr-only">Checking prices</span></span>
            </div>
          }
        </div>
      </div>

      <form (ngSubmit)="send(draft)" class="border-t border-line bg-gradient-to-b from-paper to-paper-raised px-4 pb-24 pt-3 sm:pb-4">
        <div class="mx-auto max-w-3xl">
          <div class="pk-search h-auto items-end shadow-[0_12px_30px_-20px_rgba(20,42,110,.6)]">
            <label class="flex-1">
              <span class="sr-only">Message</span>
              <textarea
                [(ngModel)]="draft"
                name="message"
                rows="1"
                maxlength="2000"
                (keydown.enter)="onEnter($any($event))"
                class="block max-h-40 w-full resize-none bg-transparent px-4 py-3.5 text-base text-charcoal outline-none placeholder:text-charcoal-muted"
                placeholder="Best lawn suits under 5000 on sale"
              ></textarea>
            </label>
            <button class="h-[52px] shrink-0 px-5" [disabled]="busy() || !draft.trim()">Ask</button>
          </div>
          <div class="t-small mt-2 flex justify-between gap-4 text-xs">
            <span>Prices come from our latest store checks. Confirm on the store before you buy.</span>
            @if (messages().length) {
              <button type="button" class="pk-link shrink-0 text-xs" (click)="reset()">New chat</button>
            }
          </div>
        </div>
      </form>
    </div>
  `,
})
export class AssistantPage {
  /** ?product=ID — set when arriving from a product page. */
  readonly product = input<string | undefined>();
  private api = inject(ApiService);
  private scroller = viewChild<ElementRef<HTMLElement>>('scroller');

  protected readonly messages = signal<Message[]>([]);
  protected readonly busy = signal(false);
  protected draft = '';
  private sessionId: string | null = readSession();

  protected productId = () => (this.product() ? Number(this.product()) : null);
  protected starters = () =>
    this.productId()
      ? ['Find cheaper alternatives to this', 'Is this the same price elsewhere?', 'Show similar items on sale', 'Which stores have sales right now?']
      : ['Best shirts under 3000 for men', 'Lawn suits on sale', 'Cheaper alternatives to Samsung Galaxy A15', 'Which stores have sales right now?'];

  onEnter(event: KeyboardEvent): void {
    if (event.shiftKey) return;
    event.preventDefault();
    this.send(this.draft);
  }

  send(text: string): void {
    const message = text.trim();
    if (!message || this.busy()) return;
    this.draft = '';
    this.messages.update((m) => [...m, { role: 'user', text: message }]);
    this.busy.set(true);
    this.scroll();
    this.api.chat(message, this.sessionId, this.productId()).subscribe({
      next: (res: ChatResponse) => {
        this.sessionId = res.session_id;
        try {
          sessionStorage.setItem(SESSION_KEY, res.session_id);
        } catch {
          /* storage unavailable */
        }
        this.messages.update((m) => [
          ...m,
          {
            role: 'assistant',
            text: res.answer,
            products: res.products.slice(0, 8),
            suggestions: res.suggestions,
            usedLlm: res.used_llm,
            trace: res.agent_trace,
          },
        ]);
        this.busy.set(false);
        this.scroll();
      },
      error: () => {
        this.messages.update((m) => [...m, { role: 'assistant', text: "Sorry — I couldn't reach the server. Please try again in a moment.", error: true }]);
        this.busy.set(false);
        this.scroll();
      },
    });
  }

  reset(): void {
    this.messages.set([]);
    this.sessionId = null;
    try {
      sessionStorage.removeItem(SESSION_KEY);
    } catch {
      /* storage unavailable */
    }
  }

  private scroll(): void {
    setTimeout(() => {
      const el = this.scroller()?.nativeElement;
      el?.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    });
  }
}
