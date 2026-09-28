import {
  ExtendedHomeAssistant,
  VacuumCardConfig,
  VacuumCardSelect,
  VacuumCardStat,
} from './types';

export interface ValetudoEntities {
  vacuum: string;
  deviceName: string;
  battery?: string;
  error?: string;
  statusFlag?: string;
  water?: string;
  mode?: string;
  currentTime?: string;
  currentArea?: string;
  consumables: string[];
}

const CONSUMABLE_PATTERN =
  /(brush|filter|sensor|cleaning|mop|detergent|bin|wheel|dock)$/;

function objectId(entityId: string): string {
  return entityId.split('.')[1] ?? '';
}

function relatedEntityIds(
  hass: ExtendedHomeAssistant,
  vacuumId: string,
  deviceId?: string,
): string[] {
  if (deviceId && hass.entities) {
    return Object.values(hass.entities)
      .filter((entry) => entry.device_id === deviceId)
      .map((entry) => entry.entity_id)
      .filter((id) => id in hass.states);
  }

  const base = `${objectId(vacuumId)}_`;
  return Object.keys(hass.states).filter((id) => objectId(id).startsWith(base));
}

function findBySuffix(
  candidates: string[],
  vacuumId: string,
  domain: string,
  suffix: string,
): string | undefined {
  const exact = `${domain}.${objectId(vacuumId)}_${suffix}`;
  if (candidates.includes(exact)) {
    return exact;
  }

  return candidates
    .filter((id) => id.startsWith(`${domain}.`) && id.endsWith(`_${suffix}`))
    .sort((a, b) => a.length - b.length)[0];
}

export function findValetudoEntities(
  hass: ExtendedHomeAssistant,
  config: Pick<VacuumCardConfig, 'entity' | 'valetudo'>,
): ValetudoEntities | null {
  if (config.valetudo === false) {
    return null;
  }

  const vacuumId = config.entity;
  const deviceId = hass.entities?.[vacuumId]?.device_id;
  const device = deviceId ? hass.devices?.[deviceId] : undefined;

  const isValetudo =
    device?.manufacturer === 'Valetudo' ||
    vacuumId.startsWith('vacuum.valetudo_');

  if (!isValetudo) {
    return null;
  }

  const candidates = relatedEntityIds(hass, vacuumId, device?.id);
  const find = (domain: string, suffix: string) =>
    findBySuffix(candidates, vacuumId, domain, suffix);

  const excluded = new Set(
    [
      find('sensor', 'battery_level'),
      find('sensor', 'current_statistics_time'),
      find('sensor', 'current_statistics_area'),
    ].filter(Boolean),
  );

  const consumables = candidates.filter((id) => {
    if (!id.startsWith('sensor.') || excluded.has(id)) {
      return false;
    }
    const { unit_of_measurement: unit, icon } = hass.states[id].attributes;
    if (unit !== 'min' && unit !== '%') {
      return false;
    }
    return icon === 'mdi:progress-wrench' || CONSUMABLE_PATTERN.test(id);
  });

  return {
    vacuum: vacuumId,
    deviceName: device?.name_by_user ?? device?.name ?? '',
    battery: find('sensor', 'battery_level'),
    error: find('sensor', 'error'),
    statusFlag: find('sensor', 'status_flag'),
    water: find('select', 'water'),
    mode: find('select', 'mode'),
    currentTime: find('sensor', 'current_statistics_time'),
    currentArea: find('sensor', 'current_statistics_area'),
    consumables,
  };
}

export function getValetudoSelects(
  valetudo: ValetudoEntities | null,
): string[] {
  return [valetudo?.mode, valetudo?.water].filter((id): id is string => !!id);
}

export function normalizeSelect(
  item: string | VacuumCardSelect,
): VacuumCardSelect {
  return typeof item === 'string' ? { entity: item } : item;
}

function stripDeviceName(
  hass: ExtendedHomeAssistant,
  entityId: string,
  vacuumName: string,
): string {
  const registryName = hass.entities?.[entityId]?.name;
  if (registryName) {
    return registryName;
  }

  const friendlyName = String(
    hass.states[entityId]?.attributes.friendly_name ?? entityId,
  );
  return vacuumName && friendlyName.startsWith(`${vacuumName} `)
    ? friendlyName.slice(vacuumName.length + 1)
    : friendlyName;
}

export function getValetudoStats(
  hass: ExtendedHomeAssistant,
  valetudo: ValetudoEntities,
  labels: { cleaningTime: string; cleanedArea: string },
): Record<string, VacuumCardStat[]> {
  const consumableStats = valetudo.consumables.map((entity_id) => {
    const isMinutes =
      hass.states[entity_id].attributes.unit_of_measurement === 'min';
    return {
      entity_id,
      ...(isMinutes && {
        value_template: '{{ (value | float(0) / 60) | round(1) }}',
      }),
      unit: isMinutes ? 'h' : '%',
      subtitle: stripDeviceName(hass, entity_id, valetudo.deviceName),
    };
  });

  const cleaningStats: VacuumCardStat[] = [];
  if (valetudo.currentTime) {
    cleaningStats.push({
      entity_id: valetudo.currentTime,
      value_template: '{{ (value | float(0) / 60) | round(0) | int }}',
      unit: 'min',
      subtitle: labels.cleaningTime,
    });
  }
  if (valetudo.currentArea) {
    cleaningStats.push({
      entity_id: valetudo.currentArea,
      value_template: '{{ (value | float(0) / 10000) | round(1) }}',
      unit: 'm²',
      subtitle: labels.cleanedArea,
    });
  }

  const stats: Record<string, VacuumCardStat[]> = {};
  if (consumableStats.length) {
    stats.default = consumableStats;
  }
  if (cleaningStats.length) {
    stats.cleaning = cleaningStats;
  }
  return stats;
}

export function getValetudoDefaults(
  hass: ExtendedHomeAssistant,
  valetudo: ValetudoEntities | null,
  labels: { cleaningTime: string; cleanedArea: string },
): Partial<Pick<VacuumCardConfig, 'battery_entity' | 'selects' | 'stats'>> {
  if (!valetudo) {
    return {};
  }

  const defaults: Partial<
    Pick<VacuumCardConfig, 'battery_entity' | 'selects' | 'stats'>
  > = {};
  if (
    valetudo.battery &&
    hass.states[valetudo.vacuum]?.attributes.battery_level == null
  ) {
    defaults.battery_entity = valetudo.battery;
  }
  const selects = getValetudoSelects(valetudo);
  if (selects.length) {
    defaults.selects = selects;
  }
  const stats = getValetudoStats(hass, valetudo, labels);
  if (Object.keys(stats).length) {
    defaults.stats = stats;
  }
  return defaults;
}
