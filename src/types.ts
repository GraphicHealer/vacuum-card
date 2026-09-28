import {
  HassEntity,
  HassEntityAttributeBase,
  HassEntityBase,
  HassServiceTarget,
} from 'home-assistant-js-websocket';
import { HomeAssistant } from 'custom-card-helpers';
import { TemplateResult, nothing } from 'lit';

export * from 'home-assistant-js-websocket';

export type TemplateNothing = typeof nothing;
export type Template = TemplateResult | TemplateNothing;

export type VacuumEntityState =
  | 'cleaning'
  | 'docked'
  | 'idle'
  | 'paused'
  | 'returning'
  | 'error'
  | 'unknown'
  | string; // for other states

export interface VacuumEntityAttributes extends HassEntityAttributeBase {
  status?: VacuumEntityState;
  state?: VacuumEntityState;
  fan_speed?: string;
  fan_speed_list?: string[];
  battery_level?: number;
  battery_icon?: string;
}

export interface VacuumEntity extends HassEntityBase {
  attributes: VacuumEntityAttributes;
  state: VacuumEntityState;
}

export interface VacuumBatteryEntity extends HassEntityBase {
  attributes: HassEntityAttributeBase;
}

export interface VacuumCardStat {
  entity_id?: string;
  attribute?: string;
  value_template?: string;
  unit?: string;
  subtitle?: string;
  icon?: string;
}

export interface VacuumCardSelect {
  entity: string;
  name?: string;
  icon?: string;
  options?: string[];
}

export interface VacuumCardAction {
  service: string;
  service_data?: Record<string, unknown>;
  target?: HassServiceTarget;
}

export interface VacuumCardShortcut {
  name?: string;
  icon?: string;
  service?: string;
  service_data?: Record<string, unknown>;
  target?: HassServiceTarget;
}

export interface ValetudoConfig {
  topic_prefix?: string;
  identifier?: string;
}

export interface VacuumCardConfig {
  entity: string;
  battery_entity: string;
  selects?: (string | VacuumCardSelect)[];
  valetudo: ValetudoConfig | boolean;
  map: string;
  map_refresh: number;
  image: string;
  show_name: boolean;
  show_status: boolean;
  show_toolbar: boolean;
  compact_view: boolean;
  stats?: Record<string, VacuumCardStat[]>;
  actions: Record<string, VacuumCardAction>;
  shortcuts: VacuumCardShortcut[];
}

export interface VacuumServiceCallParams {
  request: boolean;
}

export interface VacuumActionParams extends VacuumServiceCallParams {
  defaultService?: string;
}

export interface EntityRegistryDisplayEntry {
  entity_id: string;
  name?: string | null;
  device_id?: string;
  platform?: string;
}

export interface DeviceRegistryEntry {
  id: string;
  identifiers: [string, string][];
  manufacturer: string | null;
  name: string | null;
  name_by_user: string | null;
}

export interface AreaRegistryEntry {
  area_id: string;
  name: string;
  icon: string | null;
}

export interface VacuumEntityRegistryEntry {
  options?: {
    vacuum?: {
      area_mapping?: Record<string, string[]>;
    };
  };
}

export interface ExtendedHomeAssistant extends HomeAssistant {
  entities?: Record<string, EntityRegistryDisplayEntry>;
  devices?: Record<string, DeviceRegistryEntry>;
  areas?: Record<string, AreaRegistryEntry>;
  formatEntityState?: (stateObj: HassEntity, state?: string) => string;
}

export interface SelectEntity extends HassEntityBase {
  attributes: HassEntityAttributeBase & {
    options?: string[];
    icon?: string;
  };
}
