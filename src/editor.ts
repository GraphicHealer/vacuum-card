import { LitElement, html, nothing } from 'lit';
import {
  HomeAssistant,
  LovelaceCardConfig,
  LovelaceCardEditor,
  fireEvent,
} from 'custom-card-helpers';
import localize from './localize';
import { customElement, property, query, state } from 'lit/decorators.js';
import {
  ExtendedHomeAssistant,
  Template,
  VacuumCardConfig,
  VacuumCardShortcut,
  VacuumEntityRegistryEntry,
} from './types';
import {
  ValetudoEntities,
  findValetudoEntities,
  getValetudoRooms,
  getValetudoSelects,
} from './valetudo';
import styles from './editor.css';

type EditorConfig = LovelaceCardConfig & Partial<VacuumCardConfig>;

interface FormSchema {
  name: keyof VacuumCardConfig;
  required?: boolean;
  selector: Record<string, unknown>;
}

const SCHEMA: FormSchema[] = [
  {
    name: 'entity',
    required: true,
    selector: { entity: { filter: { domain: 'vacuum' } } },
  },
  {
    name: 'battery_entity',
    selector: {
      entity: { filter: { domain: 'sensor', device_class: 'battery' } },
    },
  },
  {
    name: 'selects',
    selector: {
      entity: {
        multiple: true,
        filter: { domain: ['select', 'input_select'] },
      },
    },
  },
  {
    name: 'map',
    selector: { entity: { filter: { domain: ['camera', 'image'] } } },
  },
  {
    name: 'map_refresh',
    selector: {
      number: { min: 1, max: 600, mode: 'box', unit_of_measurement: 's' },
    },
  },
  { name: 'image', selector: { text: {} } },
  { name: 'compact_view', selector: { boolean: {} } },
  { name: 'show_name', selector: { boolean: {} } },
  { name: 'show_status', selector: { boolean: {} } },
  { name: 'show_toolbar', selector: { boolean: {} } },
];

const DEFAULTS: Partial<VacuumCardConfig> = {
  compact_view: false,
  show_name: true,
  show_status: true,
  show_toolbar: true,
  map_refresh: 5,
};

const CLEAN_AREA_FEATURE = 16384;

@customElement('vacuum-card-editor')
export class VacuumCardEditor extends LitElement implements LovelaceCardEditor {
  @property({ attribute: false }) public hass?: HomeAssistant &
    ExtendedHomeAssistant;

  @state() private config?: EditorConfig;
  @state() private roomsMessage?: {
    type: 'error' | 'info' | 'success';
    text: string;
  };

  @state() private mappingPrompt?: {
    kind: 'explain' | 'retry';
    entity: string;
    rooms: string[];
  };

  @query('dialog.mapping-prompt') private mappingDialog?: HTMLDialogElement;

  private mappingDialogListener?: (event: Event) => void;

  setConfig(config: EditorConfig): void {
    this.config = { ...config };
  }

  public disconnectedCallback(): void {
    super.disconnectedCallback();
    this.stopWaitingForMapping();
  }

  protected updated(): void {
    if (this.mappingPrompt && !this.mappingDialog?.open) {
      this.mappingDialog?.showModal();
    } else if (!this.mappingPrompt && this.mappingDialog?.open) {
      this.mappingDialog.close();
    }

    if (this.hass && this.config && !this.config.entity) {
      const entity = Object.keys(this.hass.states).find((id) =>
        id.startsWith('vacuum.'),
      );
      if (entity) {
        this.updateConfig({ ...this.config, entity });
      }
    }
  }

  private updateConfig(config: EditorConfig): void {
    this.config = config;
    fireEvent(this, 'config-changed', { config });
  }

  private get valetudo(): ValetudoEntities | null {
    if (!this.hass || !this.config?.entity) {
      return null;
    }
    return findValetudoEntities(this.hass, {
      entity: this.config.entity,
      valetudo: this.config.valetudo ?? true,
    });
  }

  private getDetectedSelects(): string[] {
    return getValetudoSelects(this.valetudo);
  }

  private get roomSource(): ValetudoEntities | null {
    const valetudo = this.valetudo;
    if (
      !valetudo?.identifier ||
      !valetudo.mapSegments ||
      !this.hass?.states[valetudo.mapSegments]
    ) {
      return null;
    }
    return valetudo;
  }

  private async getAreaMapping(
    entityId: string,
  ): Promise<Record<string, string[]>> {
    try {
      const entry = await this.hass!.callWS<VacuumEntityRegistryEntry>({
        type: 'config/entity_registry/get',
        entity_id: entityId,
      });
      return entry.options?.vacuum?.area_mapping ?? {};
    } catch {
      return {};
    }
  }

  private stopWaitingForMapping(): void {
    if (this.mappingDialogListener) {
      window.removeEventListener('dialog-closed', this.mappingDialogListener);
      this.mappingDialogListener = undefined;
    }
  }

  private openAreaMapping(entityId: string): void {
    this.stopWaitingForMapping();
    this.mappingDialogListener = (event: Event) => {
      const { dialog } = (event as CustomEvent<{ dialog?: string }>).detail;
      if (dialog === 'ha-more-info-dialog') {
        this.stopWaitingForMapping();
        this.generateRoomShortcuts(true);
      }
    };
    window.addEventListener('dialog-closed', this.mappingDialogListener);

    this.roomsMessage = {
      type: 'info',
      text: localize('editor.map_rooms_prompt') ?? '',
    };
    this.dispatchEvent(
      new CustomEvent('hass-more-info', {
        detail: { entityId, view: 'settings' },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private continueMapping(): void {
    const prompt = this.mappingPrompt;
    this.mappingPrompt = undefined;
    if (prompt) {
      this.openAreaMapping(prompt.entity);
    }
  }

  private cancelMapping(event?: Event): void {
    event?.preventDefault();
    const prompt = this.mappingPrompt;
    this.mappingPrompt = undefined;
    if (prompt) {
      this.roomsMessage = {
        type: 'error',
        text:
          localize(
            'error.rooms_not_mapped',
            '{rooms}',
            prompt.rooms.join(', '),
          ) ?? '',
      };
    }
  }

  private async generateRoomShortcuts(afterMapping: boolean): Promise<void> {
    const valetudo = this.roomSource;
    const entity = this.config?.entity;
    if (!this.hass || !this.config || !entity || !valetudo?.mapSegments) {
      return;
    }

    const sensor = valetudo.mapSegments;
    const rooms = getValetudoRooms(this.hass, valetudo);
    if (!rooms.length) {
      this.roomsMessage = {
        type: 'error',
        text: localize('error.no_rooms', '{sensor}', sensor) ?? '',
      };
      return;
    }

    const areaBySegment = new Map<string, string>();
    const mapping = await this.getAreaMapping(entity);
    for (const [areaId, segments] of Object.entries(mapping)) {
      for (const segment of segments) {
        areaBySegment.set(String(segment), areaId);
      }
    }

    const unmapped = rooms.filter((room) => !areaBySegment.has(room.id));
    if (unmapped.length) {
      const features = Number(
        this.hass.states[entity]?.attributes.supported_features ?? 0,
      );
      if (!(features & CLEAN_AREA_FEATURE)) {
        this.roomsMessage = {
          type: 'error',
          text: localize('error.area_mapping_unsupported') ?? '',
        };
        return;
      }
      this.roomsMessage = undefined;
      this.mappingPrompt = {
        kind: afterMapping ? 'retry' : 'explain',
        entity,
        rooms: unmapped.map((room) => room.name),
      };
      return;
    }

    const topic = `${valetudo.topicPrefix}/${valetudo.identifier}/MapSegmentationCapability/clean/set`;
    const roomShortcuts: VacuumCardShortcut[] = rooms.map((room) => ({
      name: localize('editor.clean_room', '{room}', room.name) ?? room.name,
      service: 'mqtt.publish',
      service_data: {
        topic,
        payload: JSON.stringify({
          action: 'start_segment_action',
          segment_ids: [room.id],
          iterations: 1,
          customOrder: true,
        }),
      },
      icon:
        this.hass?.areas?.[areaBySegment.get(room.id) ?? '']?.icon ||
        'mdi:texture-box',
    }));

    const otherShortcuts = (this.config.shortcuts ?? []).filter(
      ({ service_data }) => service_data?.topic !== topic,
    );

    this.updateConfig({
      ...this.config,
      shortcuts: [...otherShortcuts, ...roomShortcuts],
    });
    this.roomsMessage = {
      type: 'success',
      text:
        localize(
          'editor.room_shortcuts_added',
          '{count}',
          String(roomShortcuts.length),
        ) ?? '',
    };
  }

  private renderMappingPrompt(): Template {
    const prompt = this.mappingPrompt;
    const retry = prompt?.kind === 'retry';

    return html`
      <dialog class="mapping-prompt" @cancel=${this.cancelMapping}>
        ${
          prompt
            ? html`
                <h2>
                  ${localize(
                    retry
                      ? 'editor.map_rooms_retry_title'
                      : 'editor.map_rooms_title',
                  )}
                </h2>
                <p>
                  ${localize(
                    retry
                      ? 'editor.map_rooms_retry'
                      : 'editor.map_rooms_explain',
                  )}
                </p>
                <ul>
                  ${prompt.rooms.map((room) => html`<li>${room}</li>`)}
                </ul>
                <div class="actions">
                  <ha-button
                    appearance="plain"
                    @click=${() => this.cancelMapping()}
                  >
                    ${localize('editor.cancel')}
                  </ha-button>
                  <ha-button @click=${this.continueMapping}>
                    ${localize(retry ? 'editor.try_again' : 'editor.continue')}
                  </ha-button>
                </div>
              `
            : nothing
        }
      </dialog>
    `;
  }

  private renderRoomShortcuts(): Template {
    const valetudo = this.roomSource;
    if (!valetudo?.mapSegments) {
      return nothing;
    }

    return html`
      <div class="room-shortcuts">
        <ha-button @click=${() => this.generateRoomShortcuts(false)}>
          ${localize('editor.room_shortcuts')}
        </ha-button>
        <span class="help">
          ${localize(
            'editor.room_shortcuts_help',
            '{sensor}',
            valetudo.mapSegments,
          )}
        </span>
        ${
          this.roomsMessage
            ? html`<ha-alert alert-type=${this.roomsMessage.type}>
                ${this.roomsMessage.text}
              </ha-alert>`
            : nothing
        }
        ${this.renderMappingPrompt()}
      </div>
    `;
  }

  private valueChanged(event: CustomEvent<{ value: EditorConfig }>): void {
    event.stopPropagation();
    if (!this.config) {
      return;
    }

    const value = { ...event.detail.value };
    for (const key of Object.keys(value) as (keyof EditorConfig)[]) {
      const item = value[key];
      if (
        item === undefined ||
        item === '' ||
        (key !== 'selects' && Array.isArray(item) && item.length === 0)
      ) {
        delete value[key];
      }
    }

    if (
      this.config.selects === undefined &&
      value.entity === this.config.entity &&
      String(value.selects) === String(this.getDetectedSelects())
    ) {
      delete value.selects;
    }

    this.updateConfig({ ...value, type: this.config.type });
  }

  private computeLabel = ({ name }: FormSchema): string =>
    localize(`editor.${name}`) ?? name;

  protected render(): Template {
    if (!this.hass || !this.config) {
      return nothing;
    }

    return html`
      <div class="card-config">
        <ha-form
          .hass=${this.hass}
          .data=${{
            ...DEFAULTS,
            selects: this.getDetectedSelects(),
            ...this.config,
          }}
          .schema=${SCHEMA}
          .computeLabel=${this.computeLabel}
          @value-changed=${this.valueChanged}
        ></ha-form>
        ${this.renderRoomShortcuts()}
        <strong>${localize('editor.code_only_note')}</strong>
      </div>
    `;
  }

  static get styles() {
    return styles;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'vacuum-card-editor': VacuumCardEditor;
  }
}
