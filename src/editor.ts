import { LitElement, html, nothing } from 'lit';
import {
  HomeAssistant,
  LovelaceCardConfig,
  LovelaceCardEditor,
  fireEvent,
} from 'custom-card-helpers';
import localize from './localize';
import { customElement, property, state } from 'lit/decorators.js';
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

@customElement('vacuum-card-editor')
export class VacuumCardEditor extends LitElement implements LovelaceCardEditor {
  @property({ attribute: false }) public hass?: HomeAssistant &
    ExtendedHomeAssistant;

  @state() private config?: EditorConfig;
  @state() private roomsMessage?: { type: 'error' | 'success'; text: string };

  setConfig(config: EditorConfig): void {
    this.config = { ...config };
  }

  protected updated(): void {
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

  private async generateRoomShortcuts(): Promise<void> {
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
      this.roomsMessage = {
        type: 'error',
        text:
          localize(
            'error.rooms_not_mapped',
            '{rooms}',
            unmapped.map((room) => room.name).join(', '),
          ) ?? '',
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

  private renderRoomShortcuts(): Template {
    const valetudo = this.roomSource;
    if (!valetudo?.mapSegments) {
      return nothing;
    }

    return html`
      <div class="room-shortcuts">
        <ha-button @click=${this.generateRoomShortcuts}>
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
