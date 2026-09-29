import { LitElement, html, nothing } from 'lit';
import {
  HomeAssistant,
  LovelaceCardConfig,
  LovelaceCardEditor,
  fireEvent,
} from 'custom-card-helpers';
import localize from './localize';
import { customElement, property, state } from 'lit/decorators.js';
import isEqual from 'lodash/isEqual';
import { HassServiceTarget } from 'home-assistant-js-websocket';
import {
  ExtendedHomeAssistant,
  SelectEntity,
  Template,
  VacuumCardAction,
  VacuumCardConfig,
  VacuumCardRoom,
  VacuumCardSelect,
  VacuumCardShortcut,
  VacuumCardStat,
  VacuumCardToolbarAction,
  VacuumEntityRegistryEntry,
  VacuumSegment,
} from './types';
import {
  findVacuumEntities,
  getDefaultSelects,
  getDetectedDefaults,
  normalizeSelect,
} from './valetudo';
import {
  TOOLBAR_BUTTONS,
  VACUUM_STATES,
  normalizeStats,
  toolbarOrder,
} from './config';
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
  helper?: string;
  selector: Record<string, unknown>;
}

type ItemValue = Record<string, unknown>;

const DETECTED_KEYS = [
  'battery_entity',
  'selects',
  'stats',
  'actions',
] as const;
const UI_ACTION_SELECTOR = {
  ui_action: {
    actions: ['perform-action'],
    default_action: 'perform-action',
  },
};
const SELECT_DOMAINS = ['select', 'input_select', 'vacuum'];

interface CardHelpers {
  createCardElement(config: LovelaceCardConfig): HTMLElement;
}

interface ConfigurableCard {
  getConfigElement?: () => Promise<HTMLElement>;
}

declare global {
  interface Window {
    loadCardHelpers?: () => Promise<CardHelpers>;
  }
}

async function loadSortable(): Promise<void> {
  if (customElements.get('ha-sortable') || !window.loadCardHelpers) {
    return;
  }
  const helpers = await window.loadCardHelpers();
  const card = helpers.createCardElement({ type: 'entities', entities: [] });
  await (card.constructor as ConfigurableCard).getConfigElement?.();
}

function moveItem<T>(list: T[], from: number, to: number): T[] {
  const next = [...list];
  next.splice(to, 0, ...next.splice(from, 1));
  return next;
}

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
  states?: string[];
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
  states,
  ...action
}: VacuumCardShortcut): ShortcutForm {
  return cleanItem<ShortcutForm>({
    name,
    icon,
    tap_action: actionToForm(action),
    states,
  });
}

function shortcutFromForm({
  name,
  icon,
  tap_action,
  states,
}: ShortcutForm): VacuumCardShortcut {
  return cleanItem<ItemValue>({
    name,
    icon,
    ...actionFromForm(tap_action),
    states,
  }) as VacuumCardShortcut;
}

function defaultActions(
  entity: string,
): Record<string, VacuumCardToolbarAction> {
  return Object.fromEntries(
    Object.entries(TOOLBAR_BUTTONS).map(([key, { states }]) => [
      key,
      { action: `vacuum.${key}`, target: { entity_id: entity }, states },
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
  @state() private addingTo?: string;
  @state() private unmappedRooms: string[] = [];

  private roomsChecked?: string;

  private autoRooms?: VacuumCardRoom[];

  private mappingDialogListener?: (event: Event) => void;

  private filledEntity?: string;

  setConfig(config: EditorConfig): void {
    const next: EditorConfig = { ...config };
    if (next.stats && !Array.isArray(next.stats)) {
      next.stats = normalizeStats(next.stats);
    }
    if (next.actions && 'resume' in next.actions) {
      next.actions = { ...next.actions };
      delete next.actions.resume;
    }
    this.config = next;
  }

  public connectedCallback(): void {
    super.connectedCallback();
    if (!customElements.get('ha-sortable')) {
      loadSortable().catch(() => undefined);
      customElements
        .whenDefined('ha-sortable')
        .then(() => this.requestUpdate());
    }
  }

  public disconnectedCallback(): void {
    super.disconnectedCallback();
    this.stopWaitingForMapping();
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

    this.fillDetected();
    this.checkRooms();
  }

  private detectedDefaults(
    entity: string,
  ): Partial<Pick<VacuumCardConfig, (typeof DETECTED_KEYS)[number]>> {
    if (!this.hass) {
      return {};
    }
    const detected = findVacuumEntities(this.hass, {
      entity,
      valetudo: this.config?.valetudo ?? true,
    });
    const selects = getDefaultSelects(this.hass, entity, detected);
    return {
      ...getDetectedDefaults(this.hass, detected, {
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
        this.syncRooms(entityId, true);
      }
    };
    window.addEventListener('dialog-closed', this.mappingDialogListener);
    this.dispatchEvent(
      new CustomEvent('hass-more-info', {
        detail: { entityId, view: 'settings' },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private checkRooms(): void {
    const entity = this.config?.entity;
    if (!this.hass || !entity || this.roomsChecked === entity) {
      return;
    }
    this.roomsChecked = entity;
    this.unmappedRooms = [];
    if (this.supportsCleanArea) {
      this.syncRooms(entity, false);
    }
  }

  private async syncRooms(entity: string, addMissing: boolean): Promise<void> {
    const [segments, mapping] = await Promise.all([
      this.getSegments(entity),
      this.getAreaMapping(entity),
    ]);
    if (!this.config || this.config.entity !== entity) {
      return;
    }

    const mapped = new Set(Object.values(mapping).flat().map(String));
    this.unmappedRooms = segments
      .filter(({ id }) => !mapped.has(String(id)))
      .map(({ name }) => name);

    const configured =
      this.config.rooms === undefined ||
      isEqual(this.config.rooms, this.autoRooms)
        ? undefined
        : this.config.rooms;
    const rooms = configured ?? [];
    const listed = new Set(rooms.map(({ area }) => area));
    const shortcuts = this.config.shortcuts ?? [];
    const moved = new Map(
      shortcuts.flatMap((shortcut) => {
        const area = roomArea(shortcut);
        return area && area in mapping ? [[area, shortcut] as const] : [];
      }),
    );
    const areas =
      configured && !addMissing
        ? [...moved.keys()]
        : Object.keys(mapping).filter((area) => mapping[area].length);
    const added: VacuumCardRoom[] = areas
      .filter((area) => !listed.has(area))
      .map((areaId) => {
        const area = this.hass?.areas?.[areaId];
        return {
          area: areaId,
          name: area?.name ?? areaId,
          icon: moved.get(areaId)?.icon || area?.icon || 'mdi:texture-box',
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));

    const next = [...rooms, ...added];
    if (!configured) {
      this.autoRooms = next;
    }
    if (!moved.size && isEqual(next, this.config.rooms)) {
      return;
    }
    this.updateConfig({
      ...this.config,
      rooms: next,
      shortcuts: shortcuts.filter(
        (shortcut) => !moved.has(roomArea(shortcut) ?? ''),
      ),
    });
  }

  private renderMappingAlert(): Template {
    const entity = this.config?.entity;
    if (!entity || !this.unmappedRooms.length) {
      return nothing;
    }

    return html`
      <ha-alert
        class="mapping-alert"
        alert-type="error"
        .title=${localize('editor.map_rooms_title') ?? ''}
      >
        ${localize('editor.map_rooms_explain')}
        <ul>
          ${this.unmappedRooms.map((room) => html`<li>${room}</li>`)}
        </ul>
        <ha-button slot="action" @click=${() => this.openAreaMapping(entity)}>
          ${localize('editor.map_rooms_open')}
        </ha-button>
      </ha-alert>
    `;
  }

  private setShortcuts(shortcuts: VacuumCardShortcut[]): void {
    this.updateConfig({ ...this.config!, shortcuts });
  }

  private statesSchema(helper?: string): ItemSchema {
    return {
      name: 'states',
      helper,
      selector: {
        select: {
          multiple: true,
          mode: 'list',
          options: VACUUM_STATES.map((value) => ({
            value,
            label: localize(`status.${value}`) ?? value,
          })),
        },
      },
    };
  }

  private setToolbarAction(
    key: string,
    { tap_action, states }: { tap_action?: UiActionForm; states?: string[] },
  ): void {
    this.updateConfig({
      ...this.config!,
      actions: {
        ...(this.config!.actions ?? {}),
        [key]: { ...actionFromForm(tap_action), states: states ?? [] },
      },
    });
  }

  private moveToolbarAction(order: string[], from: number, to: number): void {
    const actions = this.config!.actions ?? {};
    this.updateConfig({
      ...this.config!,
      actions: Object.fromEntries(
        moveItem(order, from, to).map((key) => [key, actions[key] ?? {}]),
      ),
    });
  }

  private renderSortable(
    items: Template[],
    onMove: (from: number, to: number) => void,
  ): Template {
    return html`
      <ha-sortable
        handle-selector=".handle"
        @item-moved=${(
          event: CustomEvent<{ oldIndex: number; newIndex: number }>,
        ) => {
          event.stopPropagation();
          onMove(event.detail.oldIndex, event.detail.newIndex);
        }}
      >
        <div class="sortable">${items}</div>
      </ha-sortable>
    `;
  }

  private renderSortableItem(content: Template): Template {
    return html`
      <div class="sortable-item">
        <div class="handle">
          <ha-icon icon="mdi:drag"></ha-icon>
        </div>
        ${content}
      </div>
    `;
  }

  private renderToolbarActions(): Template {
    const actions = this.config?.actions ?? {};
    const order = toolbarOrder(actions);
    const schema = [
      { name: 'tap_action', selector: UI_ACTION_SELECTOR },
      this.statesSchema(localize('editor.states_toolbar')),
    ];

    return html`
      <ha-expansion-panel
        outlined
        .header=${localize('editor.toolbar_actions')}
        .secondary=${localize('editor.toolbar_actions_help')}
      >
        <div class="items">
          ${this.renderSortable(
            order.map((key) => {
              const item = actions[key] ?? {};
              const { states } = TOOLBAR_BUTTONS[key];
              return this.renderSortableItem(html`
                <ha-expansion-panel
                  outlined
                  .header=${localize(`editor.action_${key}`) ?? key}
                  .secondary=${item.action ?? ''}
                >
                  <div class="item">
                    <ha-form
                      .hass=${this.hass}
                      .data=${cleanItem<ItemValue>({
                        tap_action: actionToForm(item),
                        states: item.states ?? states,
                      })}
                      .schema=${schema}
                      .computeLabel=${this.computeItemLabel}
                      .computeHelper=${this.computeItemHelper}
                      @value-changed=${(
                        event: CustomEvent<{
                          value: {
                            tap_action?: UiActionForm;
                            states?: string[];
                          };
                        }>,
                      ) => {
                        event.stopPropagation();
                        this.setToolbarAction(key, event.detail.value);
                      }}
                    ></ha-form>
                  </div>
                </ha-expansion-panel>
              `);
            }),
            (from, to) => this.moveToolbarAction(order, from, to),
          )}
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
      this.statesSchema(localize('editor.states_shortcut')),
    ];

    return html`
      <ha-expansion-panel
        outlined
        .header=${localize('editor.shortcuts')}
        .secondary=${localize('editor.item_count', '{count}', String(items.length))}
      >
        <div class="items">
          ${this.renderSortable(
            items.map((item, index) =>
              this.renderItem(
                item.name || item.action || '',
                item.action ?? '',
                schema,
                shortcutToForm(item),
                (value) =>
                  this.setShortcuts(
                    items.map((old, i) =>
                      i === index
                        ? shortcutFromForm(value as ShortcutForm)
                        : old,
                    ),
                  ),
                () => this.setShortcuts(items.filter((_, i) => i !== index)),
              ),
            ),
            (from, to) => this.setShortcuts(moveItem(items, from, to)),
          )}
          <ha-button
            appearance="plain"
            @click=${() =>
              this.setShortcuts([
                ...items,
                { name: localize('editor.new_shortcut') ?? 'Shortcut' },
              ])}
          >
            <ha-icon slot="start" icon="mdi:plus"></ha-icon>
            ${localize('editor.shortcut_add')}
          </ha-button>
        </div>
      </ha-expansion-panel>
    `;
  }

  private setRooms(rooms: VacuumCardRoom[]): void {
    this.updateConfig({ ...this.config!, rooms });
  }

  private roomSchema({ area }: VacuumCardRoom): ItemSchema[] {
    const entry = area ? this.hass?.areas?.[area] : undefined;
    return [
      { name: 'area', required: true, selector: { area: {} } },
      { name: 'name', selector: { text: { placeholder: entry?.name } } },
      {
        name: 'icon',
        selector: { icon: { placeholder: entry?.icon ?? 'mdi:texture-box' } },
      },
      this.statesSchema(localize('editor.states_room')),
    ];
  }

  private renderRooms(): Template {
    const items = this.config?.rooms ?? [];
    if (!this.supportsCleanArea && !items.length) {
      return nothing;
    }

    return html`
      <ha-expansion-panel
        outlined
        .header=${localize('editor.rooms')}
        .secondary=${localize('editor.rooms_help')}
      >
        <div class="items">
          ${this.renderSortable(
            items.map((item, index) =>
              this.renderItem(
                item.name ||
                  (item.area && this.hass?.areas?.[item.area]?.name) ||
                  item.area,
                item.area,
                this.roomSchema(item),
                { ...item },
                (value) =>
                  this.setRooms(
                    items.map((old, i) =>
                      i === index ? (value as unknown as VacuumCardRoom) : old,
                    ),
                  ),
                () => this.setRooms(items.filter((_, i) => i !== index)),
              ),
            ),
            (from, to) => this.setRooms(moveItem(items, from, to)),
          )}
          <ha-button
            appearance="plain"
            @click=${() => this.setRooms([...items, { area: '' }])}
          >
            <ha-icon slot="start" icon="mdi:plus"></ha-icon>
            ${localize('editor.room_add')}
          </ha-button>
        </div>
      </ha-expansion-panel>
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

  private computeItemHelper = ({ helper }: ItemSchema): string | undefined =>
    helper;

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
    return this.renderSortableItem(html`
      <ha-expansion-panel outlined .header=${header} .secondary=${secondary}>
        <div class="item">
          <ha-form
            .hass=${this.hass}
            .data=${data}
            .schema=${schema}
            .computeLabel=${this.computeItemLabel}
            .computeHelper=${this.computeItemHelper}
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
    `);
  }

  private renderAddEntity(
    key: string,
    filter: Record<string, unknown>,
    onAdd: (entityId: string) => void,
  ): Template {
    if (this.addingTo !== key) {
      return html`
        <ha-button appearance="plain" @click=${() => (this.addingTo = key)}>
          <ha-icon slot="start" icon="mdi:plus"></ha-icon>
          ${localize('editor.item_add')}
        </ha-button>
      `;
    }

    return html`
      <div class="add-entity">
        <ha-form
          .hass=${this.hass}
          .data=${{}}
          .schema=${[{ name: 'add', selector: { entity: { filter } } }]}
          .computeLabel=${this.computeItemLabel}
          @value-changed=${(
            event: CustomEvent<{ value: { add?: string } }>,
          ) => {
            event.stopPropagation();
            if (event.detail.value.add) {
              this.addingTo = undefined;
              onAdd(event.detail.value.add);
            }
          }}
        ></ha-form>
        <ha-button
          appearance="plain"
          @click=${() => (this.addingTo = undefined)}
        >
          ${localize('editor.cancel')}
        </ha-button>
      </div>
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
          ${this.renderSortable(
            items.map((item, index) =>
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
                      i === index
                        ? (value as unknown as VacuumCardSelect)
                        : old,
                    ),
                  ),
                () => this.setSelects(items.filter((_, i) => i !== index)),
              ),
            ),
            (from, to) => this.setSelects(moveItem(items, from, to)),
          )}
          ${this.renderAddEntity(
            'selects',
            { domain: SELECT_DOMAINS },
            (entity) => this.setSelects([...items, { entity }]),
          )}
        </div>
      </ha-expansion-panel>
    `;
  }

  private setStats(stats: VacuumCardStat[]): void {
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
      this.statesSchema(localize('editor.states_stat')),
    ];
  }

  private renderStats(): Template {
    const list = normalizeStats(this.config?.stats) ?? [];

    return html`
      <ha-expansion-panel
        outlined
        .header=${localize('editor.stats')}
        .secondary=${localize('editor.item_count', '{count}', String(list.length))}
      >
        <div class="items">
          ${this.renderSortable(
            list.map((stat, index) =>
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
                    list.map((old, i) => (i === index ? value : old)),
                  ),
                () => this.setStats(list.filter((_, i) => i !== index)),
              ),
            ),
            (from, to) => this.setStats(moveItem(list, from, to)),
          )}
          ${this.renderAddEntity('stats', {}, (entity_id) =>
            this.setStats([...list, { entity_id }]),
          )}
        </div>
      </ha-expansion-panel>
    `;
  }

  protected render(): Template {
    if (!this.hass || !this.config) {
      return nothing;
    }

    return html`
      <div class="card-config">
        ${this.renderMappingAlert()}
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
        ${this.renderSelects()} ${this.renderStats()}
        ${this.renderToolbarActions()} ${this.renderRooms()}
        ${this.renderShortcuts()}
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
