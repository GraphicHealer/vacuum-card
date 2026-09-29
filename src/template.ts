import { LitElement, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { HomeAssistant } from 'custom-card-helpers';

type Unsubscribe = () => Promise<void>;

/**
 * Renders a Home Assistant template with `value` as a variable.
 * Resubscribes only when the template or value changes, and keeps showing
 * the last rendered result until the new one arrives.
 */
@customElement('vacuum-card-template')
export class VacuumCardTemplate extends LitElement {
  @property({ attribute: false }) public hass?: HomeAssistant;

  @property() public template = '';

  @property({ attribute: false }) public value?: unknown;

  @state() private rendered?: unknown;

  private key?: string;

  private unsubscribe?: Promise<Unsubscribe>;

  connectedCallback(): void {
    super.connectedCallback();
    if (this.hasUpdated) {
      this.subscribe();
    }
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.unsubscribeTemplate();
    this.key = undefined;
  }

  protected updated(): void {
    this.subscribe();
  }

  private subscribe(): void {
    if (!this.isConnected || !this.hass || !this.template) {
      return;
    }
    const key = JSON.stringify([this.template, this.value]);
    if (key === this.key) {
      return;
    }
    this.key = key;
    this.unsubscribeTemplate();
    this.unsubscribe = this.hass.connection.subscribeMessage<{
      result: unknown;
    }>(
      ({ result }) => {
        if (this.key === key) {
          this.rendered = result;
        }
      },
      {
        type: 'render_template',
        template: this.template,
        variables: { value: this.value },
      },
    );
    this.unsubscribe.catch((error) => {
      console.error('vacuum-card: failed to render template', error);
    });
  }

  private unsubscribeTemplate(): void {
    const unsubscribe = this.unsubscribe;
    this.unsubscribe = undefined;
    unsubscribe
      ?.then((unsub) => unsub())
      .catch(() => {
        // Already unsubscribed.
      });
  }

  protected render() {
    return this.rendered ?? this.value ?? nothing;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'vacuum-card-template': VacuumCardTemplate;
  }
}
