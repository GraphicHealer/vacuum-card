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
import buildConfig, {
  SHORTCUT_STATES,
  TOOLBAR_BUTTONS,
  isShownIn,
  vacuumStateGroup,
} from './config';
import {
  Template,
  VacuumCardAction,
  VacuumCardConfig,
  VacuumCardSelect,
  VacuumCardStat,
  VacuumEntity,
  HassEntity,
  VacuumBatteryEntity,
  VacuumEntityState,
  VacuumServiceCallParams,
  VacuumActionParams,
  ExtendedHomeAssistant,
  SelectEntity,
} from './types';
import {
  ValetudoEntities,
  findValetudoEntities,
  getDefaultSelects,
  getValetudoStats,
  normalizeSelect,
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

@customElement('vacuum-card')
export class VacuumCard extends LitElement {
  @property({ attribute: false }) public hass!: ExtendedHomeAssistant;

  @state() private config!: VacuumCardConfig;
  @state() private requestInProgress = false;

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

  get selectItems(): VacuumCardSelect[] {
    return (
      this.config.selects ??
      getDefaultSelects(this.hass, this.config.entity, this.valetudo)
    ).map(normalizeSelect);
  }

  get stats(): VacuumCardStat[] {
    if (this.config.stats || !this.valetudo) {
      return this.config.stats ?? [];
    }

    return getValetudoStats(this.hass, this.valetudo, {
      cleaningTime: localize('stats.cleaning_time') ?? 'Cleaning time',
      cleanedArea: localize('stats.cleaned_area') ?? 'Cleaned area',
    });
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
    const statEntities = this.stats.map((stat) => stat.entity_id);

    return [
      this.config.entity,
      this.config.map,
      this.batteryEntity?.entity_id,
      ...this.selectItems.map(({ entity }) => entity),
      ...statEntities,
      valetudo?.error,
      valetudo?.statusFlag,
    ].filter((id): id is string => !!id);
  }

  public setConfig(config: VacuumCardConfig): void {
    this.config = buildConfig(config);
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

  private callService({ action, data, target }: VacuumCardAction) {
    const [domain, name] = action.split('.');
    this.hass.callService(domain, name, data, target);
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

  private handleFanSpeed(entityId: string, fanSpeed?: string): void {
    if (
      !fanSpeed ||
      this.hass.states[entityId]?.attributes.fan_speed === fanSpeed
    ) {
      return;
    }

    this.hass.callService('vacuum', 'set_fan_speed', {
      entity_id: entityId,
      fan_speed: fanSpeed,
    });
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
            title=${ariaLabel ?? selectedLabel}
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

  private renderFanSpeed({
    entity: entityId,
    name,
    icon,
    options: shown,
  }: VacuumCardSelect): Template {
    const stateObj = this.hass.states[entityId] as VacuumEntity | undefined;
    const { fan_speed: value, fan_speed_list: speeds } =
      stateObj?.attributes ?? {};
    const options = Array.isArray(speeds)
      ? speeds.filter((speed) => !shown?.length || shown.includes(speed))
      : [];

    if (!value || options.length === 0) {
      return nothing;
    }

    return this.renderDropdown({
      icon: icon ?? 'mdi:fan',
      value,
      options,
      onSelect: (e) => this.handleFanSpeed(entityId, e.detail.item?.value),
      formatLabel: (speed: string) =>
        localize(`source.${speed.toLowerCase()}`) ?? speed,
      ariaLabel: name ?? localize('editor.fan_speed') ?? 'Fan speed',
    });
  }

  private renderSelect(item: VacuumCardSelect): Template {
    if (item.entity.startsWith('vacuum.')) {
      return this.renderFanSpeed(item);
    }

    const { entity: entityId, name, icon, options: shown } = item;
    const stateObj = this.hass.states[entityId] as SelectEntity | undefined;
    const options = stateObj?.attributes.options?.filter(
      (option) => !shown?.length || shown.includes(option),
    );

    if (!stateObj || !Array.isArray(options) || options.length === 0) {
      return nothing;
    }

    const fallbackIcon =
      icon ?? stateObj.attributes.icon ?? 'mdi:format-list-bulleted';

    return this.renderDropdown({
      icon: fallbackIcon,
      value: stateObj.state,
      options,
      onSelect: (e) => this.handleSelectOption(entityId, e.detail.item?.value),
      formatLabel: (value: string) => this.formatSelectOption(stateObj, value),
      ariaLabel: name ?? String(stateObj.attributes.friendly_name ?? entityId),
      renderIcon: (value?: string) =>
        customElements.get('ha-state-icon') && !(icon && value === undefined)
          ? html`<ha-state-icon
              .stateObj=${stateObj}
              .stateValue=${value ?? stateObj.state}
            ></ha-state-icon>`
          : html`<ha-icon icon=${fallbackIcon}></ha-icon>`,
    });
  }

  private renderSelects(): Template {
    return html`${this.selectItems.map((item) => this.renderSelect(item))}`;
  }

  private handleVacuumAction(
    action: string,
    params: VacuumActionParams = { request: true },
  ) {
    return () => {
      const override = this.config.actions[action];
      if (!override?.action) {
        return this.callVacuumService(params.defaultService || action, params);
      }

      this.callService({ ...override, action: override.action });
      if (params.request) {
        this.requestInProgress = true;
        this.requestUpdate();
      }
    };
  }

  private getAttributes(entity: VacuumEntity) {
    const { status, state } = entity.attributes;

    return {
      ...entity.attributes,
      status: status ?? state ?? entity.state,
    };
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
    const statsList = this.stats.filter(({ states }) =>
      isShownIn(state, states),
    );

    const stats = statsList.map(
      ({ entity_id, attribute, value_template, unit, subtitle, icon }) => {
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
            ${
              icon
                ? html`<div class="stats-icon">
                    <ha-icon icon=${icon}></ha-icon>
                  </div>`
                : nothing
            }
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

    const group = vacuumStateGroup(state);
    const active = ['cleaning', 'paused', 'returning'].includes(group);
    const buttons = Object.entries(TOOLBAR_BUTTONS)
      .filter(([key, { states }]) =>
        isShownIn(state, this.config.actions[key]?.states, states),
      )
      .map(([key, { icon }]) => {
        const label = localize(
          key === 'start' && (group === 'paused' || group === 'returning')
            ? 'common.continue'
            : `common.${key}`,
        );
        const onClick = this.handleVacuumAction(key, {
          request: key !== 'locate',
        });
        return active
          ? html`
              <button class="toolbar-button" @click="${onClick}">
                <ha-icon icon="${icon}"></ha-icon>
                ${label}
              </button>
            `
          : html`
              <ha-icon-button label="${label}" @click="${onClick}">
                <ha-icon icon="${icon}"></ha-icon>
              </ha-icon-button>
            `;
      });

    const shortcuts = this.config.shortcuts
      .filter(({ states }) => isShownIn(state, states, SHORTCUT_STATES))
      .map(({ name, action, icon, data, target }) => {
        const execute = () => {
          if (action) {
            return this.callService({ action, data, target });
          }
        };
        return html`
          <ha-icon-button label="${name}" @click="${execute}">
            <ha-icon icon="${icon}"></ha-icon>
          </ha-icon-button>
        `;
      });

    if (!buttons.length && !shortcuts.length) {
      return nothing;
    }

    return html`
      <div class="toolbar">
        ${buttons}
        ${
          shortcuts.length
            ? html`<div class="fill-gap"></div>
                ${shortcuts}`
            : nothing
        }
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
              ${this.renderSelects()} ${this.renderBattery()}
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
