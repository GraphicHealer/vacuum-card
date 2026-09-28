import { LitElement, html, nothing } from 'lit';
import {
  HomeAssistant,
  LovelaceCardConfig,
  LovelaceCardEditor,
  fireEvent,
} from 'custom-card-helpers';
import localize from './localize';
import { customElement, property, query, state } from 'lit/decorators.js';
import isEqual from 'lodash/isEqual';
import { HassServiceTarget } from 'home-assistant-js-websocket';
import {
  ExtendedHomeAssistant,
  SelectEntity,
  Template,
  VacuumCardConfig,
  VacuumCardSelect,
  VacuumCardShortcut,
  VacuumCardStat,
  VacuumEntityRegistryEntry,
} from './types';
import {
  ValetudoEntities,
  findValetudoEntities,
  getValetudoDefaults,
  getValetudoRooms,
  normalizeSelect,
} from './valetudo';
import styles from './editor.css';

type EditorConfig = LovelaceCardConfig & Partial<VacuumCardConfig>;

interface FormSchema {
  name: keyof VacuumCardConfig;
  required?: boolean;
  selector: Record<string, unknown>;
}

interface ItemSchema {
  name: string;
  required?: boolean;
  selector: Record<string, unknown>;
}

type ItemValue = Record<string, unknown>;

const DETECTED_KEYS = ['battery_entity', 'selects', 'stats'] as const;
const SELECT_DOMAINS = ['select', 'input_select'];
const STAT_STATES = ['default', 'cleaning'];

interface ShortcutForm extends ItemValue {
  name?: string;
  icon?: string;
  tap_action?: {
    action?: string;
    perform_action?: string;
    data?: Record<string, unknown>;
    target?: HassServiceTarget;
  };
}

function shortcutToForm({
  name,
  icon,
  service,
  service_data,
  target,
}: VacuumCardShortcut): ShortcutForm {
  return cleanItem<ShortcutForm>({
    name,
    icon,
    tap_action: service
      ? cleanItem({
          action: 'perform-action',
          perform_action: service,
          data: service_data,
          target,
        })
      : undefined,
  });
}

function shortcutFromForm({
  name,
  icon,
  tap_action,
}: ShortcutForm): VacuumCardShortcut {
  return cleanItem<ItemValue>({
    name,
    icon,
    service: tap_action?.perform_action || undefined,
    service_data:
      tap_action?.data && Object.keys(tap_action.data).length
        ? tap_action.data
        : undefined,
    target:
      tap_action?.target && Object.keys(tap_action.target).length
        ? tap_action.target
        : undefined,
  }) as VacuumCardShortcut;
}

function roomSegment(
  { service_data }: VacuumCardShortcut,
  topic: string,
): string | undefined {
  if (service_data?.topic !== topic) {
    return undefined;
  }
  let payload = service_data.payload;
  if (typeof payload === 'string') {
    try {
      payload = JSON.parse(payload);
    } catch {
      return undefined;
    }
  }
  const ids = (payload as { segment_ids?: unknown } | undefined)?.segment_ids;
  return Array.isArray(ids) && ids.length === 1 ? String(ids[0]) : undefined;
}

function cleanItem<T extends ItemValue>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(
      ([, item]) =>
        item !== undefined &&
        item !== '' &&
        !(Array.isArray(item) && item.length === 0),
    ),
  ) as T;
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

  private filledEntity?: string;

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

    this.fillDetected();
  }

  private detectedDefaults(
    entity: string,
  ): Partial<Pick<VacuumCardConfig, (typeof DETECTED_KEYS)[number]>> {
    if (!this.hass) {
      return {};
    }
    const valetudo = findValetudoEntities(this.hass, {
      entity,
      valetudo: this.config?.valetudo ?? true,
    });
    return getValetudoDefaults(this.hass, valetudo, {
      cleaningTime: localize('stats.cleaning_time') ?? 'Cleaning time',
      cleanedArea: localize('stats.cleaned_area') ?? 'Cleaned area',
    });
  }

  private fillDetected(): void {
    const entity = this.config?.entity;
    if (!this.hass || !this.config || !entity || this.filledEntity === entity) {
      return;
    }

    const previous = this.filledEntity
      ? this.detectedDefaults(this.filledEntity)
      : undefined;
    this.filledEntity = entity;
    const detected = this.detectedDefaults(entity);

    const config: EditorConfig = { ...this.config };
    let changed = false;
    for (const key of DETECTED_KEYS) {
      if (
        previous &&
        config[key] !== undefined &&
        isEqual(config[key], previous[key])
      ) {
        delete config[key];
        changed = true;
      }
      if (config[key] === undefined && detected[key] !== undefined) {
        Object.assign(config, { [key]: detected[key] });
        changed = true;
      }
    }

    if (changed) {
      this.updateConfig(config);
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
    const allRooms = getValetudoRooms(this.hass, valetudo);
    if (!allRooms.length) {
      this.roomsMessage = {
        type: 'error',
        text: localize('error.no_rooms', '{sensor}', sensor) ?? '',
      };
      return;
    }

    const topic = `${valetudo.topicPrefix}/${valetudo.identifier}/MapSegmentationCapability/clean/set`;
    const shortcuts = this.config.shortcuts ?? [];
    const existing = new Set(shortcuts.map((item) => roomSegment(item, topic)));
    const rooms = allRooms.filter((room) => !existing.has(room.id));
    if (!rooms.length) {
      this.mappingPrompt = undefined;
      this.roomsMessage = {
        type: 'info',
        text: localize('editor.room_shortcuts_none') ?? '',
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

    this.updateConfig({
      ...this.config,
      shortcuts: [...shortcuts, ...roomShortcuts],
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

  private setShortcuts(shortcuts: VacuumCardShortcut[]): void {
    this.updateConfig({ ...this.config!, shortcuts });
  }

  private renderShortcuts(): Template {
    const items = this.config?.shortcuts ?? [];
    const schema: ItemSchema[] = [
      { name: 'name', selector: { text: {} } },
      { name: 'icon', selector: { icon: {} } },
      {
        name: 'tap_action',
        selector: {
          ui_action: {
            actions: ['perform-action'],
            default_action: 'perform-action',
          },
        },
      },
    ];

    return html`
      <div class="items">
        <div class="items-title">${localize('editor.shortcuts')}</div>
        ${items.map((item, index) =>
          this.renderItem(
            item.name || item.service || '',
            item.service ?? '',
            schema,
            shortcutToForm(item),
            (value) =>
              this.setShortcuts(
                items.map((old, i) =>
                  i === index ? shortcutFromForm(value as ShortcutForm) : old,
                ),
              ),
            () => this.setShortcuts(items.filter((_, i) => i !== index)),
          ),
        )}
        <ha-button
          appearance="plain"
          @click=${() =>
            this.setShortcuts([
              ...items,
              { name: localize('editor.new_shortcut') ?? 'Shortcut' },
            ])}
        >
          ${localize('editor.shortcut_add')}
        </ha-button>
        ${this.renderRoomShortcuts()}
      </div>
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

    this.updateConfig({ ...value, type: this.config.type });
  }

  private computeLabel = ({ name }: FormSchema): string =>
    localize(`editor.${name}`) ?? name;

  private computeItemLabel = ({ name }: ItemSchema): string =>
    localize(`editor.item_${name}`) ?? name;

  private entityName(entityId?: string): string | undefined {
    return entityId
      ? String(
          this.hass?.states[entityId]?.attributes.friendly_name ?? entityId,
        )
      : undefined;
  }

  private renderItem(
    header: string,
    secondary: string,
    schema: ItemSchema[],
    data: ItemValue,
    onChange: (value: ItemValue) => void,
    onRemove: () => void,
  ): Template {
    return html`
      <ha-expansion-panel outlined .header=${header} .secondary=${secondary}>
        <div class="item">
          <ha-form
            .hass=${this.hass}
            .data=${data}
            .schema=${schema}
            .computeLabel=${this.computeItemLabel}
            @value-changed=${(event: CustomEvent<{ value: ItemValue }>) => {
              event.stopPropagation();
              onChange(cleanItem(event.detail.value));
            }}
          ></ha-form>
          <ha-button variant="danger" appearance="plain" @click=${onRemove}>
            ${localize('editor.remove')}
          </ha-button>
        </div>
      </ha-expansion-panel>
    `;
  }

  private renderAddEntity(
    filter: Record<string, unknown>,
    onAdd: (entityId: string) => void,
  ): Template {
    return html`
      <ha-form
        .hass=${this.hass}
        .data=${{}}
        .schema=${[{ name: 'add', selector: { entity: { filter } } }]}
        .computeLabel=${this.computeItemLabel}
        @value-changed=${(event: CustomEvent<{ value: { add?: string } }>) => {
          event.stopPropagation();
          if (event.detail.value.add) {
            onAdd(event.detail.value.add);
          }
        }}
      ></ha-form>
    `;
  }

  private setSelects(items: VacuumCardSelect[]): void {
    this.updateConfig({
      ...this.config!,
      selects: items.map((item) =>
        item.name || item.icon || item.options?.length ? item : item.entity,
      ),
    });
  }

  private selectSchema({ entity }: VacuumCardSelect): ItemSchema[] {
    const stateObj = this.hass?.states[entity] as SelectEntity | undefined;
    const options = stateObj?.attributes.options ?? [];
    return [
      {
        name: 'entity',
        required: true,
        selector: { entity: { filter: { domain: SELECT_DOMAINS } } },
      },
      { name: 'name', selector: { text: {} } },
      {
        name: 'icon',
        selector: { icon: { placeholder: stateObj?.attributes.icon } },
      },
      {
        name: 'options',
        selector: {
          select: {
            multiple: true,
            mode: 'list',
            options: options.map((value) => ({
              value,
              label:
                (stateObj && this.hass?.formatEntityState?.(stateObj, value)) ||
                value,
            })),
          },
        },
      },
    ];
  }

  private renderSelects(): Template {
    const items = (this.config?.selects ?? []).map(normalizeSelect);

    return html`
      <div class="items">
        <div class="items-title">${localize('editor.selects')}</div>
        ${items.map((item, index) =>
          this.renderItem(
            item.name || (this.entityName(item.entity) ?? item.entity),
            item.entity,
            this.selectSchema(item),
            { ...item },
            (value) =>
              this.setSelects(
                items.map((old, i) =>
                  i === index ? (value as unknown as VacuumCardSelect) : old,
                ),
              ),
            () => this.setSelects(items.filter((_, i) => i !== index)),
          ),
        )}
        ${this.renderAddEntity({ domain: SELECT_DOMAINS }, (entity) =>
          this.setSelects([...items, { entity }]),
        )}
      </div>
    `;
  }

  private setStats(state: string, list: VacuumCardStat[]): void {
    const stats = { ...(this.config!.stats ?? {}) };
    if (list.length) {
      stats[state] = list;
    } else {
      delete stats[state];
    }
    this.updateConfig({ ...this.config!, stats });
  }

  private statSchema(stat: VacuumCardStat): ItemSchema[] {
    const entityId = stat.entity_id || this.config?.entity;
    return [
      { name: 'entity_id', selector: { entity: {} } },
      { name: 'attribute', selector: { attribute: { entity_id: entityId } } },
      { name: 'subtitle', selector: { text: {} } },
      {
        name: 'icon',
        selector: {
          icon: {
            placeholder: entityId
              ? this.hass?.states[entityId]?.attributes.icon
              : undefined,
          },
        },
      },
      { name: 'unit', selector: { text: {} } },
      { name: 'value_template', selector: { template: {} } },
    ];
  }

  private renderStats(state: string, list: VacuumCardStat[]): Template {
    const title =
      state === 'default'
        ? localize('editor.stats_default')
        : localize(
            'editor.stats_state',
            '{state}',
            localize(`status.${state}`) ?? state,
          );

    return html`
      <div class="items">
        <div class="items-title">${title}</div>
        ${list.map((stat, index) =>
          this.renderItem(
            stat.subtitle ||
              this.entityName(stat.entity_id) ||
              stat.attribute ||
              '',
            [stat.entity_id, stat.attribute].filter(Boolean).join(' · '),
            this.statSchema(stat),
            { ...stat },
            (value) =>
              this.setStats(
                state,
                list.map((old, i) => (i === index ? value : old)),
              ),
            () =>
              this.setStats(
                state,
                list.filter((_, i) => i !== index),
              ),
          ),
        )}
        ${this.renderAddEntity({}, (entity_id) =>
          this.setStats(state, [...list, { entity_id }]),
        )}
      </div>
    `;
  }

  private renderAllStats(): Template {
    const stats = this.config?.stats ?? {};
    const states = [...new Set([...STAT_STATES, ...Object.keys(stats)])];
    return html`${states.map((state) =>
      this.renderStats(state, stats[state] ?? []),
    )}`;
  }

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
            ...this.config,
          }}
          .schema=${SCHEMA}
          .computeLabel=${this.computeLabel}
          @value-changed=${this.valueChanged}
        ></ha-form>
        ${this.renderSelects()} ${this.renderAllStats()}
        ${this.renderShortcuts()}
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
