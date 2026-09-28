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
  VacuumCardAction,
  VacuumCardConfig,
  VacuumCardSelect,
  VacuumCardShortcut,
  VacuumCardStat,
  VacuumEntityRegistryEntry,
  VacuumSegment,
} from './types';
import {
  findValetudoEntities,
  getDefaultSelects,
  getValetudoDefaults,
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

const DETECTED_KEYS = [
  'battery_entity',
  'selects',
  'stats',
  'actions',
] as const;
const TOOLBAR_ACTIONS: Record<string, string> = {
  start: 'start',
  pause: 'pause',
  resume: 'start',
  stop: 'stop',
  locate: 'locate',
  return_to_base: 'return_to_base',
};
const UI_ACTION_SELECTOR = {
  ui_action: {
    actions: ['perform-action'],
    default_action: 'perform-action',
  },
};
const SELECT_DOMAINS = ['select', 'input_select', 'vacuum'];
const STAT_STATES = ['default', 'cleaning'];

interface UiActionForm {
  action?: string;
  perform_action?: string;
  data?: Record<string, unknown>;
  target?: HassServiceTarget;
}

interface ShortcutForm extends ItemValue {
  name?: string;
  icon?: string;
  tap_action?: UiActionForm;
}

function actionToForm({
  action,
  data,
  target,
}: Partial<VacuumCardAction>): UiActionForm | undefined {
  return action
    ? cleanItem({
        action: 'perform-action',
        perform_action: action,
        data,
        target,
      })
    : undefined;
}

function actionFromForm(
  form?: UiActionForm,
): Partial<VacuumCardAction> | undefined {
  if (!form?.perform_action) {
    return undefined;
  }
  return cleanItem<ItemValue>({
    action: form.perform_action,
    data: form.data && Object.keys(form.data).length ? form.data : undefined,
    target:
      form.target && Object.keys(form.target).length ? form.target : undefined,
  });
}

function shortcutToForm({
  name,
  icon,
  ...action
}: VacuumCardShortcut): ShortcutForm {
  return cleanItem<ShortcutForm>({
    name,
    icon,
    tap_action: actionToForm(action),
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
    ...actionFromForm(tap_action),
  }) as VacuumCardShortcut;
}

function defaultActions(entity: string): Record<string, VacuumCardAction> {
  return Object.fromEntries(
    Object.entries(TOOLBAR_ACTIONS).map(([key, service]) => [
      key,
      { action: `vacuum.${service}`, target: { entity_id: entity } },
    ]),
  );
}

function roomArea({ action, data }: VacuumCardShortcut): string | undefined {
  if (action !== 'vacuum.clean_area') {
    return undefined;
  }
  const ids = data?.cleaning_area_id;
  if (typeof ids === 'string') {
    return ids;
  }
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
    const selects = getDefaultSelects(this.hass, entity, valetudo);
    return {
      ...getValetudoDefaults(this.hass, valetudo, {
        cleaningTime: localize('stats.cleaning_time') ?? 'Cleaning time',
        cleanedArea: localize('stats.cleaned_area') ?? 'Cleaned area',
      }),
      ...(selects.length ? { selects } : {}),
      actions: defaultActions(entity),
    };
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

  private get supportsCleanArea(): boolean {
    const entity = this.config?.entity;
    const features = Number(
      (entity && this.hass?.states[entity]?.attributes.supported_features) ?? 0,
    );
    return (features & CLEAN_AREA_FEATURE) !== 0;
  }

  private async getSegments(entityId: string): Promise<VacuumSegment[]> {
    try {
      const { segments } = await this.hass!.callWS<{
        segments: VacuumSegment[];
      }>({ type: 'vacuum/get_segments', entity_id: entityId });
      return segments ?? [];
    } catch {
      return [];
    }
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
    const entity = this.config?.entity;
    if (!this.hass || !this.config || !entity || !this.supportsCleanArea) {
      return;
    }

    const [segments, mapping] = await Promise.all([
      this.getSegments(entity),
      this.getAreaMapping(entity),
    ]);
    if (!segments.length) {
      this.roomsMessage = {
        type: 'error',
        text: localize('error.no_rooms') ?? '',
      };
      return;
    }

    const mapped = new Set(Object.values(mapping).flat().map(String));
    const unmapped = segments.filter(({ id }) => !mapped.has(String(id)));
    if (unmapped.length) {
      this.roomsMessage = undefined;
      this.mappingPrompt = {
        kind: afterMapping ? 'retry' : 'explain',
        entity,
        rooms: unmapped.map(({ name }) => name),
      };
      return;
    }

    const shortcuts = this.config.shortcuts ?? [];
    const existing = new Set(shortcuts.map(roomArea));
    const roomShortcuts: VacuumCardShortcut[] = Object.entries(mapping)
      .filter(([areaId, ids]) => ids.length && !existing.has(areaId))
      .map(([areaId]) => {
        const area = this.hass?.areas?.[areaId];
        const name = area?.name ?? areaId;
        return {
          name: localize('editor.clean_room', '{room}', name) ?? name,
          icon: area?.icon || 'mdi:texture-box',
          action: 'vacuum.clean_area',
          target: { entity_id: entity },
          data: { cleaning_area_id: [areaId] },
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));

    this.mappingPrompt = undefined;
    if (!roomShortcuts.length) {
      this.roomsMessage = {
        type: 'info',
        text: localize('editor.room_shortcuts_none') ?? '',
      };
      return;
    }

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

  private renderToolbarActions(): Template {
    const actions = this.config?.actions ?? {};
    const data = Object.fromEntries(
      Object.entries(actions).map(([key, action]) => [
        key,
        actionToForm(action),
      ]),
    );

    return html`
      <ha-expansion-panel
        outlined
        .header=${localize('editor.toolbar_actions')}
        .secondary=${localize('editor.toolbar_actions_help')}
      >
        <div class="item">
          <ha-form
            .hass=${this.hass}
            .data=${data}
            .schema=${Object.keys(TOOLBAR_ACTIONS).map((name) => ({
              name,
              selector: UI_ACTION_SELECTOR,
            }))}
            .computeLabel=${({ name }: ItemSchema) =>
              localize(`editor.action_${name}`) ?? name}
            @value-changed=${(
              event: CustomEvent<{ value: Record<string, UiActionForm> }>,
            ) => {
              event.stopPropagation();
              const next: Record<string, VacuumCardAction> = {};
              for (const [key, form] of Object.entries(event.detail.value)) {
                const action = actionFromForm(form);
                if (action?.action) {
                  next[key] = action as VacuumCardAction;
                }
              }
              this.updateConfig({ ...this.config!, actions: next });
            }}
          ></ha-form>
        </div>
      </ha-expansion-panel>
    `;
  }

  private renderShortcuts(): Template {
    const items = this.config?.shortcuts ?? [];
    const schema: ItemSchema[] = [
      { name: 'name', selector: { text: {} } },
      { name: 'icon', selector: { icon: {} } },
      { name: 'tap_action', selector: UI_ACTION_SELECTOR },
    ];

    return html`
      <ha-expansion-panel
        outlined
        .header=${localize('editor.shortcuts')}
        .secondary=${localize('editor.item_count', '{count}', String(items.length))}
      >
        <div class="items">
          ${items.map((item, index) =>
            this.renderItem(
              item.name || item.action || '',
              item.action ?? '',
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
      </ha-expansion-panel>
    `;
  }

  private renderRoomShortcuts(): Template {
    if (!this.supportsCleanArea) {
      return nothing;
    }

    return html`
      <div class="room-shortcuts">
        <ha-button @click=${() => this.generateRoomShortcuts(false)}>
          ${localize('editor.room_shortcuts')}
        </ha-button>
        <span class="help"> ${localize('editor.room_shortcuts_help')} </span>
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

  private selectOptions(entity: string): { value: string; label: string }[] {
    const stateObj = this.hass?.states[entity];
    if (entity.startsWith('vacuum.')) {
      const speeds = stateObj?.attributes.fan_speed_list;
      return (Array.isArray(speeds) ? (speeds as string[]) : []).map(
        (value) => ({
          value,
          label: localize(`source.${value.toLowerCase()}`) ?? value,
        }),
      );
    }
    return (
      (stateObj as SelectEntity | undefined)?.attributes.options ?? []
    ).map((value) => ({
      value,
      label:
        (stateObj && this.hass?.formatEntityState?.(stateObj, value)) || value,
    }));
  }

  private selectSchema({ entity }: VacuumCardSelect): ItemSchema[] {
    const stateObj = this.hass?.states[entity];
    return [
      {
        name: 'entity',
        required: true,
        selector: { entity: { filter: { domain: SELECT_DOMAINS } } },
      },
      { name: 'name', selector: { text: {} } },
      {
        name: 'icon',
        selector: {
          icon: {
            placeholder: entity.startsWith('vacuum.')
              ? 'mdi:fan'
              : stateObj?.attributes.icon,
          },
        },
      },
      {
        name: 'options',
        selector: {
          select: {
            multiple: true,
            mode: 'list',
            options: this.selectOptions(entity),
          },
        },
      },
    ];
  }

  private renderSelects(): Template {
    const items = (this.config?.selects ?? []).map(normalizeSelect);

    return html`
      <ha-expansion-panel
        outlined
        .header=${localize('editor.selects')}
        .secondary=${localize('editor.item_count', '{count}', String(items.length))}
      >
        <div class="items">
          ${items.map((item, index) =>
            this.renderItem(
              item.name ||
                (item.entity.startsWith('vacuum.')
                  ? localize('editor.fan_speed')
                  : this.entityName(item.entity)) ||
                item.entity,
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
      </ha-expansion-panel>
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
      <ha-expansion-panel
        outlined
        .header=${title}
        .secondary=${localize('editor.item_count', '{count}', String(list.length))}
      >
        <div class="items">
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
      </ha-expansion-panel>
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
        ${this.renderShortcuts()} ${this.renderToolbarActions()}
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
