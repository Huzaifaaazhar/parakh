import { ChangeDetectionStrategy, Component, ElementRef, inject, input, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { ApiService } from '../core/api.service';
import { ChatResponse, Product } from '../core/models';
import { PkrPipe } from '../shared/format';
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
  imports: [FormsModule, RouterLink, PkrPipe, ProductImage],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="mx-auto flex h-[calc(100dvh-8.5rem)] max-w-3xl flex-col px-4 md:h-[calc(100dvh-4.5rem)]">
      <div #scroller class="flex-1 space-y-6 overflow-y-auto py-6" aria-live="polite">
        @if (!messages().length) {
          <div class="pt-6 text-center sm:pt-12">
            <p class="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-ink to-pink-deep font-display text-xl text-white">✦</p>
            <h1 class="text-3xl font-semibold">Your shopping assistant</h1>
            <p class="mx-auto mt-2 max-w-md text-sm text-muted">
              Ask in plain words. I search every store we track, compare similar items and find the best deals.
              @if (productId()) {
                <br /><span class="font-medium text-blue">I'm looking at the product you came from — ask me for cheaper alternatives.</span>
              }
            </p>
            <div class="mx-auto mt-6 grid max-w-xl gap-2 sm:grid-cols-2">
              @for (s of starters(); track s) {
                <button type="button" class="card px-4 py-3 text-left text-sm transition-colors hover:border-ink/40" (click)="send(s)">{{ s }}</button>
              }
            </div>
          </div>
        }

        @for (m of messages(); track $index) {
          @if (m.role === 'user') {
            <div class="flex justify-end">
              <p class="max-w-[85%] rounded-2xl rounded-br-md bg-gradient-to-r from-blue to-ink px-4 py-2.5 text-sm text-white">{{ m.text }}</p>
            </div>
          } @else {
            <div class="flex gap-3">
              <span class="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-ink to-pink-deep text-sm text-white" aria-hidden="true">✦</span>
              <div class="min-w-0 flex-1 space-y-3">
                <div class="whitespace-pre-line text-sm leading-relaxed" [class.text-sale]="m.error">{{ m.text }}</div>
                @if (m.products?.length) {
                  <div class="-mx-1 flex snap-x gap-3 overflow-x-auto px-1 pb-2">
                    @for (p of m.products; track p.id) {
                      <a [routerLink]="['/products', p.id]" class="card w-40 shrink-0 snap-start overflow-hidden transition-colors hover:border-ink/40">
                        <div class="aspect-square bg-paper"><app-product-image [src]="p.image_url" [vertical]="p.vertical" /></div>
                        <div class="p-2.5">
                          <p class="truncate text-[11px] font-semibold uppercase tracking-wider text-muted">{{ p.store_name }}</p>
                          <p class="line-clamp-2 text-xs font-medium">{{ p.product_name }}</p>
                          <p class="mt-1 text-sm font-semibold" [class.text-sale]="p.discount_percentage > 0">{{ p.price | pkr }}</p>
                        </div>
                      </a>
                    }
                  </div>
                }
                @if (m.suggestions?.length && $last) {
                  <div class="flex flex-wrap gap-2">
                    @for (s of m.suggestions; track s) {
                      <button type="button" class="chip" (click)="send(s)">{{ s }}</button>
                    }
                  </div>
                }
                @if (m.trace?.length) {
                  <details class="text-[11px] text-muted">
                    <summary class="cursor-pointer select-none">How I answered {{ m.usedLlm ? '(AI)' : '(rules)' }}</summary>
                    <ol class="mt-1 list-decimal space-y-0.5 pl-5">
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
          <div class="flex gap-3" aria-label="Assistant is typing">
            <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-ink to-pink-deep text-sm text-white">✦</span>
            <span class="flex items-center gap-1 pt-2">
              <span class="h-2 w-2 animate-bounce rounded-full bg-muted [animation-delay:-0.3s]"></span>
              <span class="h-2 w-2 animate-bounce rounded-full bg-muted [animation-delay:-0.15s]"></span>
              <span class="h-2 w-2 animate-bounce rounded-full bg-muted"></span>
            </span>
          </div>
        }
      </div>

      <form (ngSubmit)="send(draft)" class="sticky bottom-0 border-t border-line bg-paper pb-4 pt-3">
        <div class="flex items-end gap-2 rounded-2xl border border-line bg-card p-2 shadow-sm focus-within:border-ink">
          <label class="flex-1">
            <span class="sr-only">Message</span>
            <textarea
              [(ngModel)]="draft"
              name="message"
              rows="1"
              maxlength="2000"
              (keydown.enter)="onEnter($any($event))"
              class="max-h-40 w-full resize-none bg-transparent px-2 py-1.5 text-sm focus:outline-none"
              placeholder="e.g. best lawn suits under 5000 on sale"
            ></textarea>
          </label>
          <button class="btn-primary h-9 w-9 shrink-0 p-0" [disabled]="busy() || !draft.trim()" aria-label="Send">↑</button>
        </div>
        <div class="mt-2 flex justify-between text-[11px] text-muted">
          <span>Prices come from our latest store scans — confirm on the store before buying.</span>
          @if (messages().length) {
            <button type="button" class="hover:text-ink" (click)="reset()">New chat</button>
          }
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
      ? ['Find cheaper alternatives to this', 'Is this the same price elsewhere?', 'Show similar items on sale', 'Which stores have sales?']
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
