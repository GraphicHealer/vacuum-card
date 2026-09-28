import { LitElement, html, nothing } from 'lit';
import type { CSSResultGroup, PropertyValues } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import {
  fireEvent,
  ServiceCallRequest,
  computeStateDisplay,
  stateIcon,
} from 'custom-card-helpers';
import registerTemplates from 'ha-template';
import get from 'lodash/get';
import localize from './localize';
import styles from './styles.css';
import buildConfig from './config';
import {
  Template,
  VacuumCardAction,
  VacuumCardConfig,
  VacuumCardStat,
  VacuumEntity,
  HassEntity,
  VacuumBatteryEntity,
  VacuumEntityState,
  VacuumServiceCallParams,
  VacuumActionParams,
  ExtendedHomeAssistant,
  SelectEntity,
  VacuumEntityRegistryEntry,
  VacuumRoom,
} from './types';
import {
  ValetudoEntities,
  findValetudoEntities,
  getValetudoSelects,
  getValetudoStats,
} from './valetudo';
import DEFAULT_IMAGE from './vacuum.svg';

registerTemplates();

// String in the right side will be replaced by Rollup
const PKG_VERSION = 'PKG_VERSION_VALUE';

console.info(
  `%c VACUUM-CARD %c ${PKG_VERSION}`,
  'color: white; background: blue; font-weight: 700;',
  'color: blue; background: white; font-weight: 700;',
);

if (!customElements.get('ha-icon-button')) {
  customElements.define(
    'ha-icon-button',
    class extends (customElements.get('paper-icon-button') ?? HTMLElement) {},
  );
}

const CLEAN_AREA_FEATURE = 16384;

@customElement('vacuum-card')
export class VacuumCard extends LitElement {
  @property({ attribute: false }) public hass!: ExtendedHomeAssistant;

  @state() private config!: VacuumCardConfig;
  @state() private requestInProgress = false;
  @state() private selectedRooms: string[] = [];
  @state() private areaMapping?: Record<string, string[]> | null;

  private areaMappingKey?: [string, unknown];

  private thumbUpdater: ReturnType<typeof setInterval> | null = null;
  private valetudoCache: {
    key: unknown[];
    value: ValetudoEntities | null;
  } | null = null;

  static get styles(): CSSResultGroup {
    return styles;
  }

  public static async getConfigElement() {
    await import('./editor');
    return document.createElement('vacuum-card-editor');
  }

  static getStubConfig(_: unknown, entities: string[]) {
    const [vacuumEntity] = entities.filter((eid) => eid.startsWith('vacuum'));

    return {
      entity: vacuumEntity ?? '',
    };
  }

  get entity(): VacuumEntity {
    return this.hass.states[this.config.entity] as VacuumEntity;
  }

  get map(): HassEntity | null {
    if (!this.hass || !this.config.map) {
      return null;
    }
    return this.hass.states[this.config.map];
  }

  get valetudo(): ValetudoEntities | null {
    if (!this.hass || !this.config) {
      return null;
    }

    const key = [
      this.config,
      this.hass.entities,
      this.hass.devices,
      this.hass.entities ? null : Object.keys(this.hass.states).length,
    ];

    if (
      !this.valetudoCache ||
      this.valetudoCache.key.some((value, i) => value !== key[i])
    ) {
      this.valetudoCache = {
        key,
        value: findValetudoEntities(this.hass, this.config),
      };
    }

    return this.valetudoCache.value;
  }

  get batteryEntity(): VacuumBatteryEntity | null {
    if (!this.hass) {
      return null;
    }

    const batteryEntityId =
      this.config.battery_entity ||
      (this.entity?.attributes.battery_level == null
        ? (this.valetudo?.battery ?? this.findDeviceBatteryEntity())
        : undefined);

    if (!batteryEntityId) {
      return null;
    }
    return (this.hass.states[batteryEntityId] as VacuumBatteryEntity) ?? null;
  }

  get selectEntityIds(): string[] {
    return this.config.selects ?? getValetudoSelects(this.valetudo);
  }

  get stats(): Record<string, VacuumCardStat[]> {
    if (Object.keys(this.config.stats).length || !this.valetudo) {
      return this.config.stats;
    }

    return getValetudoStats(this.hass, this.valetudo, {
      cleaningTime: localize('stats.cleaning_time') ?? 'Cleaning time',
      cleanedArea: localize('stats.cleaned_area') ?? 'Cleaned area',
    });
  }

  get rooms(): VacuumRoom[] {
    return Object.entries(this.areaMapping ?? {})
      .filter(([, segments]) => segments.length > 0)
      .map(([areaId]) => {
        const area = this.hass.areas?.[areaId];
        return {
          id: areaId,
          name: area?.name ?? areaId,
          icon: area?.icon || 'mdi:texture-box',
        };
      });
  }

  get supportsCleanArea(): boolean {
    const features = Number(this.entity?.attributes.supported_features ?? 0);
    return (features & CLEAN_AREA_FEATURE) !== 0;
  }

  private async loadAreaMapping(): Promise<void> {
    const key: [string, unknown] = [this.config.entity, this.hass.entities];
    if (
      this.areaMappingKey?.[0] === key[0] &&
      this.areaMappingKey[1] === key[1]
    ) {
      return;
    }
    this.areaMappingKey = key;

    try {
      const entry = await this.hass.callWS<VacuumEntityRegistryEntry>({
        type: 'config/entity_registry/get',
        entity_id: this.config.entity,
      });
      const mapping = entry.options?.vacuum?.area_mapping;
      this.areaMapping =
        mapping && Object.keys(mapping).length ? mapping : null;
    } catch {
      this.areaMapping = null;
    }
  }

  private findDeviceBatteryEntity(): string | undefined {
    const deviceId = this.hass.entities?.[this.config.entity]?.device_id;
    if (!deviceId || !this.hass.entities) {
      return undefined;
    }

    return Object.values(this.hass.entities).find(
      ({ entity_id, device_id }) =>
        device_id === deviceId &&
        entity_id.startsWith('sensor.') &&
        this.hass.states[entity_id]?.attributes.device_class === 'battery',
    )?.entity_id;
  }

  private getWatchedEntityIds(): string[] {
    const valetudo = this.valetudo;
    const statEntities = Object.values(this.stats)
      .flat()
      .map((stat) => stat.entity_id);

    return [
      this.config.entity,
      this.config.map,
      this.batteryEntity?.entity_id,
      ...this.selectEntityIds,
      ...statEntities,
      valetudo?.error,
      valetudo?.statusFlag,
    ].filter((id): id is string => !!id);
  }

  public setConfig(config: VacuumCardConfig): void {
    this.config = buildConfig(config);
    this.selectedRooms = [];
    this.areaMappingKey = undefined;
    this.areaMapping = undefined;
    if (this.isConnected) {
      this.startMapRefresh();
    }
  }

  public getCardSize(): number {
    return this.config.compact_view ? 3 : 8;
  }

  public shouldUpdate(changedProps: PropertyValues): boolean {
    if (!this.config) {
      return false;
    }

    if (changedProps.size > 1 || !changedProps.has('hass')) {
      return true;
    }

    const oldHass = changedProps.get('hass') as
      ExtendedHomeAssistant | undefined;

    if (
      !oldHass ||
      oldHass.locale !== this.hass.locale ||
      oldHass.themes !== this.hass.themes ||
      oldHass.entities !== this.hass.entities ||
      oldHass.areas !== this.hass.areas ||
      oldHass.devices !== this.hass.devices
    ) {
      return true;
    }

    return this.getWatchedEntityIds().some(
      (id) => oldHass.states[id] !== this.hass.states[id],
    );
  }

  protected updated(changedProps: PropertyValues) {
    const oldHass = changedProps.get('hass') as
      ExtendedHomeAssistant | undefined;
    if (
      oldHass &&
      oldHass.states[this.config.entity]?.state !==
        this.hass.states[this.config.entity]?.state
    ) {
      this.requestInProgress = false;
    }

    if (this.config.show_rooms && this.hass) {
      this.loadAreaMapping();
    }
  }

  public connectedCallback() {
    super.connectedCallback();
    this.startMapRefresh();
  }

  public disconnectedCallback() {
    super.disconnectedCallback();
    this.stopMapRefresh();
  }

  private startMapRefresh() {
    this.stopMapRefresh();
    if (!this.config || this.config.compact_view || !this.config.map) {
      return;
    }
    this.thumbUpdater = setInterval(
      () => this.requestUpdate(),
      Math.max(this.config.map_refresh, 1) * 1000,
    );
  }

  private stopMapRefresh() {
    if (this.thumbUpdater) {
      clearInterval(this.thumbUpdater);
      this.thumbUpdater = null;
    }
  }

  private handleMore(entityId: string = this.entity.entity_id): void {
    fireEvent(
      this,
      'hass-more-info',
      {
        entityId,
      },
      {
        bubbles: false,
        composed: true,
      },
    );
  }

  private callService(action: VacuumCardAction) {
    const { service, service_data, target } = action;
    const [domain, name] = service.split('.');
    this.hass.callService(domain, name, service_data, target);
  }

  private callVacuumService(
    service: ServiceCallRequest['service'],
    params: VacuumServiceCallParams = { request: true },
    options: ServiceCallRequest['serviceData'] = {},
  ) {
    this.hass.callService('vacuum', service, {
      entity_id: this.config.entity,
      ...options,
    });

    if (params.request) {
      this.requestInProgress = true;
      this.requestUpdate();
    }
  }

  private handleSpeed(e: CustomEvent<{ item?: { value?: string } }>): void {
    this.callVacuumService(
      'set_fan_speed',
      {
        request: false,
      },
      {
        fan_speed: e.detail.item?.value,
      },
    );
  }

  private handleSelectOption(entityId: string, option?: string): void {
    if (!option || this.hass.states[entityId]?.state === option) {
      return;
    }

    const [domain] = entityId.split('.');
    this.hass.callService(domain, 'select_option', {
      entity_id: entityId,
      option,
    });
  }

  private renderDropdown({
    icon,
    value,
    options,
    onSelect,
    formatLabel,
    ariaLabel,
    renderIcon,
  }: {
    icon: string;
    value: string;
    options: string[];
    onSelect: (e: CustomEvent<{ item?: { value?: string } }>) => void;
    formatLabel: (value: string) => string;
    ariaLabel?: string;
    renderIcon?: (value?: string) => Template;
  }): Template {
    const selectedLabel = formatLabel(value);

    return html`
      <div class="tip dropdown-tip" @click=${(e: Event) => e.stopPropagation()}>
        <ha-dropdown placement="bottom" @wa-select=${onSelect}>
          <button
            class="dropdown-trigger"
            slot="trigger"
            aria-label=${ariaLabel ?? selectedLabel}
          >
            ${renderIcon ? renderIcon() : html`<ha-icon icon=${icon}></ha-icon>`}
            <span class="tip-title">${selectedLabel}</span>
            <ha-icon
              class="dropdown-trigger-arrow"
              icon="mdi:menu-down"
            ></ha-icon>
          </button>
          ${repeat(
            options,
            (item) => item,
            (item) => html`
              <ha-dropdown-item .value=${item} ?selected=${item === value}>
                ${
                  renderIcon
                    ? html`<span slot="icon">${renderIcon(item)}</span>`
                    : nothing
                }
                ${formatLabel(item)}
              </ha-dropdown-item>
            `,
          )}
        </ha-dropdown>
      </div>
    `;
  }

  private formatSelectOption(stateObj: SelectEntity, option: string): string {
    const translated = this.hass.formatEntityState?.(stateObj, option);
    if (translated && translated !== option) {
      return translated;
    }

    const key = option.toLowerCase();
    return (
      localize(`mode.${key}`) ??
      localize(`source.${key}`) ??
      option.charAt(0).toUpperCase() + option.slice(1).replace(/_/g, ' ')
    );
  }

  private renderSelect(entityId: string): Template {
    const stateObj = this.hass.states[entityId] as SelectEntity | undefined;
    const options = stateObj?.attributes.options;

    if (!stateObj || !Array.isArray(options) || options.length === 0) {
      return nothing;
    }

    const fallbackIcon = stateObj.attributes.icon ?? 'mdi:format-list-bulleted';

    return this.renderDropdown({
      icon: fallbackIcon,
      value: stateObj.state,
      options,
      onSelect: (e) => this.handleSelectOption(entityId, e.detail.item?.value),
      formatLabel: (value: string) => this.formatSelectOption(stateObj, value),
      ariaLabel: String(stateObj.attributes.friendly_name ?? entityId),
      renderIcon: (value?: string) =>
        customElements.get('ha-state-icon')
          ? html`<ha-state-icon
              .stateObj=${stateObj}
              .stateValue=${value ?? stateObj.state}
            ></ha-state-icon>`
          : html`<ha-icon icon=${fallbackIcon}></ha-icon>`,
    });
  }

  private renderSelects(): Template {
    return html`${this.selectEntityIds.map((id) => this.renderSelect(id))}`;
  }

  private handleVacuumAction(
    action: string,
    params: VacuumActionParams = { request: true },
  ) {
    return () => {
      if (!this.config.actions[action]) {
        return this.callVacuumService(params.defaultService || action, params);
      }

      this.callService(this.config.actions[action]);
    };
  }

  private getAttributes(entity: VacuumEntity) {
    const { status, state } = entity.attributes;

    return {
      ...entity.attributes,
      status: status ?? state ?? entity.state,
    };
  }

  private renderSource(): Template {
    const { fan_speed: source, fan_speed_list: sources } = this.getAttributes(
      this.entity,
    );

    if (!Array.isArray(sources) || sources.length === 0 || !source) {
      return nothing;
    }

    return this.renderDropdown({
      icon: 'mdi:fan',
      value: source,
      options: sources,
      onSelect: this.handleSpeed,
      formatLabel: (value: string) =>
        localize(`source.${value.toLowerCase()}`) ?? value,
      ariaLabel: localize('source.fan_speed') || 'Fan speed',
    });
  }

  private getBatteryDisplay(): {
    icon: string;
    value: string;
    entityId: string;
  } | null {
    const batteryEntity = this.batteryEntity;

    if (batteryEntity) {
      const value = computeStateDisplay(
        this.hass.localize,
        batteryEntity,
        this.hass.locale,
      );
      const icon = stateIcon(batteryEntity) ?? 'mdi:battery';

      return {
        icon,
        value,
        entityId: batteryEntity.entity_id,
      };
    }

    const { battery_level, battery_icon } = this.getAttributes(this.entity);

    if (battery_level == null) {
      return null;
    }

    return {
      icon: battery_icon ?? 'mdi:battery',
      value: `${battery_level}%`,
      entityId: this.entity.entity_id,
    };
  }

  private renderBattery(): Template {
    const battery = this.getBatteryDisplay();

    if (!battery) {
      return nothing;
    }

    return html`
      <div class="tip" @click="${() => this.handleMore(battery.entityId)}">
        <ha-icon icon="${battery.icon}"></ha-icon>
        <span class="tip-title">${battery.value}</span>
      </div>
    `;
  }

  private renderMapOrImage(state: VacuumEntityState): Template {
    if (this.config.compact_view) {
      return nothing;
    }

    if (this.map) {
      return this.map && this.map.attributes.entity_picture
        ? html`
            <img
              class="map"
              src="${this.map.attributes.entity_picture}&v=${Date.now()}"
              @click=${() => this.handleMore(this.config.map)}
            />
          `
        : nothing;
    }

    const src =
      this.config.image === 'default' ? DEFAULT_IMAGE : this.config.image;

    return html`
      <img
        class="vacuum ${state}"
        src="${src}"
        @click="${() => this.handleMore()}"
      />
    `;
  }

  private renderStats(state: VacuumEntityState): Template {
    const allStats = this.stats;
    const statsList = allStats[state] || allStats.default || [];

    const stats = statsList.map(
      ({ entity_id, attribute, value_template, unit, subtitle }) => {
        if (!entity_id && !attribute) {
          return nothing;
        }

        const entity = entity_id ? this.hass.states[entity_id] : this.entity;
        if (!entity) {
          return nothing;
        }

        const state = attribute
          ? get(entity.attributes, attribute)
          : entity.state;

        const value = value_template
          ? html`
              <ha-template
                .hass=${this.hass}
                .template=${value_template}
                .value=${state}
                .variables=${{ value: state }}
              ></ha-template>
            `
          : (state ?? '');

        return html`
          <div class="stats-block" @click="${() => this.handleMore(entity_id)}">
            <span class="stats-value">${value}</span>
            ${unit}
            <div class="stats-subtitle">${subtitle}</div>
          </div>
        `;
      },
    );

    if (!stats.length) {
      return nothing;
    }

    return html`<div class="stats">${stats}</div>`;
  }

  private renderName(): Template {
    const { friendly_name } = this.getAttributes(this.entity);

    if (!this.config.show_name) {
      return nothing;
    }

    return html` <div class="vacuum-name">${friendly_name}</div> `;
  }

  private getValetudoStatus(): string | undefined {
    const valetudo = this.valetudo;
    if (!valetudo) {
      return undefined;
    }

    const { state } = this.entity;
    const error = valetudo.error ? this.hass.states[valetudo.error] : undefined;
    if (
      state === 'error' &&
      error &&
      !['No error', 'unknown', 'unavailable', ''].includes(error.state)
    ) {
      return error.state;
    }

    const flag = valetudo.statusFlag
      ? this.hass.states[valetudo.statusFlag]?.state
      : undefined;
    if (state === 'cleaning' && flag) {
      const flagStatus: Record<string, string> = {
        segment: 'status.segment_cleaning',
        zone: 'status.zoned_cleaning',
        spot: 'status.spot',
        target: 'status.going_to_target',
        mapping: 'status.mapping',
      };
      return flagStatus[flag] ? localize(flagStatus[flag]) : undefined;
    }

    return undefined;
  }

  private renderStatus(): Template {
    const status = String(this.getAttributes(this.entity).status ?? '');
    const localizedStatus =
      this.getValetudoStatus() ||
      localize(`status.${status.toLowerCase()}`) ||
      status;

    if (!this.config.show_status) {
      return nothing;
    }

    return html`
      <div class="status">
        ${
          this.requestInProgress
            ? html`<ha-spinner class="status-spinner" size="tiny"></ha-spinner>`
            : nothing
        }
        <span class="status-text" alt=${localizedStatus}>
          ${localizedStatus}
        </span>
      </div>
    `;
  }

  private renderToolbar(state: VacuumEntityState): Template {
    if (!this.config.show_toolbar) {
      return nothing;
    }

    switch (state) {
      case 'on':
      case 'auto':
      case 'spot':
      case 'edge':
      case 'single_room':
      case 'cleaning': {
        return html`
          <div class="toolbar">
            <button
              class="toolbar-button"
              @click="${this.handleVacuumAction('pause')}"
            >
              <ha-icon icon="hass:pause"></ha-icon>
              ${localize('common.pause')}
            </button>
            <button
              class="toolbar-button"
              @click="${this.handleVacuumAction('stop')}"
            >
              <ha-icon icon="hass:stop"></ha-icon>
              ${localize('common.stop')}
            </button>
            <button
              class="toolbar-button"
              @click="${this.handleVacuumAction('return_to_base')}"
            >
              <ha-icon icon="hass:home-map-marker"></ha-icon>
              ${localize('common.return_to_base')}
            </button>
          </div>
        `;
      }

      case 'paused': {
        return html`
          <div class="toolbar">
            <button
              class="toolbar-button"
              @click="${this.handleVacuumAction('resume', {
                defaultService: 'start',
                request: true,
              })}"
            >
              <ha-icon icon="hass:play"></ha-icon>
              ${localize('common.continue')}
            </button>
            <button
              class="toolbar-button"
              @click="${this.handleVacuumAction('return_to_base')}"
            >
              <ha-icon icon="hass:home-map-marker"></ha-icon>
              ${localize('common.return_to_base')}
            </button>
          </div>
        `;
      }

      case 'returning': {
        return html`
          <div class="toolbar">
            <button
              class="toolbar-button"
              @click="${this.handleVacuumAction('resume', {
                defaultService: 'start',
                request: true,
              })}"
            >
              <ha-icon icon="hass:play"></ha-icon>
              ${localize('common.continue')}
            </button>
            <button
              class="toolbar-button"
              @click="${this.handleVacuumAction('pause')}"
            >
              <ha-icon icon="hass:pause"></ha-icon>
              ${localize('common.pause')}
            </button>
          </div>
        `;
      }
      case 'docked':
      case 'idle':
      default: {
        const selectedRooms = this.selectedRooms.filter((id) =>
          this.rooms.some((room) => room.id === id),
        );
        const buttons = this.config.shortcuts.map(
          ({ name, service, icon, service_data, target }) => {
            const execute = () => {
              if (service) {
                return this.callService({ service, service_data, target });
              }
            };
            return html`
              <ha-icon-button label="${name}" @click="${execute}">
                <ha-icon icon="${icon}"></ha-icon>
              </ha-icon-button>
            `;
          },
        );

        const dockButton = html`
          <ha-icon-button
            label="${localize('common.return_to_base')}"
            @click="${this.handleVacuumAction('return_to_base')}"
            ><ha-icon icon="hass:home-map-marker"></ha-icon>
          </ha-icon-button>
        `;

        return html`
          <div class="toolbar">
            ${
              selectedRooms.length
                ? html`
                    <button
                      class="toolbar-button"
                      @click="${() => this.handleCleanRooms(selectedRooms)}"
                    >
                      <ha-icon icon="hass:play"></ha-icon>
                      ${localize(
                        'common.clean_rooms',
                        '{count}',
                        String(selectedRooms.length),
                      )}
                    </button>
                  `
                : html`
                    <ha-icon-button
                      label="${localize('common.start')}"
                      @click="${this.handleVacuumAction('start')}"
                      ><ha-icon icon="hass:play"></ha-icon>
                    </ha-icon-button>
                  `
            }

            <ha-icon-button
              label="${localize('common.locate')}"
              @click="${this.handleVacuumAction('locate', { request: false })}"
              ><ha-icon icon="mdi:map-marker"></ha-icon>
            </ha-icon-button>

            ${state === 'idle' ? dockButton : ''}
            <div class="fill-gap"></div>
            ${buttons}
          </div>
        `;
      }
    }
  }

  private handleCleanRooms(areaIds: string[]): void {
    this.hass.callService('vacuum', 'clean_area', {
      entity_id: this.config.entity,
      cleaning_area_id: areaIds,
    });
    this.selectedRooms = [];
    this.requestInProgress = true;
  }

  private toggleRoom(id: string): void {
    this.selectedRooms = this.selectedRooms.includes(id)
      ? this.selectedRooms.filter((room) => room !== id)
      : [...this.selectedRooms, id];
  }

  private renderRooms(state: VacuumEntityState): Template {
    if (
      !this.config.show_rooms ||
      !this.config.show_toolbar ||
      ['cleaning', 'paused', 'returning'].includes(state)
    ) {
      return nothing;
    }

    if (!this.supportsCleanArea) {
      return html`<div class="rooms-error">
        ${localize('error.clean_area_unsupported')}
      </div>`;
    }

    if (this.areaMapping === undefined) {
      return nothing;
    }

    const rooms = this.rooms;
    if (!rooms.length) {
      return html`<div class="rooms-error">
        ${localize('error.rooms_not_mapped')}
      </div>`;
    }

    return html`
      <div class="rooms">
        ${repeat(
          rooms,
          (room) => room.id,
          (room) => html`
            <button
              class="room ${
                this.selectedRooms.includes(room.id) ? 'selected' : ''
              }"
              aria-pressed=${this.selectedRooms.includes(room.id)}
              @click=${() => this.toggleRoom(room.id)}
            >
              <ha-icon icon=${room.icon}></ha-icon>
              ${room.name}
            </button>
          `,
        )}
      </div>
    `;
  }

  private renderUnavailable(): Template {
    return html`
      <ha-card>
        <div class="preview not-available">
          <div class="metadata">
            <div class="not-available">${localize('common.not_available')}</div>
          </div>
        </div>
      </ha-card>
    `;
  }

  protected render(): Template {
    if (!this.config || !this.hass || !this.entity) {
      return this.renderUnavailable();
    }

    return html`
      <ha-card>
        <ha-ripple></ha-ripple>
        <div class="preview">
          <div class="header">
            <div class="tips">
              ${this.renderSource()} ${this.renderSelects()}
              ${this.renderBattery()}
            </div>
            <ha-icon-button
              class="more-info"
              icon="mdi:dots-vertical"
              ?more-info="true"
              @click="${() => this.handleMore()}"
              ><ha-icon icon="mdi:dots-vertical"></ha-icon
            ></ha-icon-button>
          </div>

          ${this.renderMapOrImage(this.entity.state)}

          <div class="metadata">
            ${this.renderName()} ${this.renderStatus()}
          </div>

          ${this.renderStats(this.entity.state)}
        </div>

        ${this.renderRooms(this.entity.state)}
        ${this.renderToolbar(this.entity.state)}
      </ha-card>
    `;
  }
}

declare global {
  interface Window {
    customCards?: unknown[];
  }
}

window.customCards = window.customCards || [];
window.customCards.push({
  preview: true,
  type: 'vacuum-card',
  name: localize('common.name'),
  description: localize('common.description'),
});
