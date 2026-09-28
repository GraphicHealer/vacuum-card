import {
  ExtendedHomeAssistant,
  VacuumCardConfig,
  VacuumCardSelect,
  VacuumCardStat,
} from './types';
import { VACUUM_STATES } from './config';

export interface DetectedEntities {
  vacuum: string;
  deviceName: string;
  valetudo: boolean;
  battery?: string;
  error?: string;
  statusFlag?: string;
  selects: string[];
  currentTime?: string;
  currentArea?: string;
  consumables: string[];
}

const CONSUMABLE_PATTERN =
  /(brush|filter|sensor|cleaning|mop|detergent|bin|wheel|dock)$/;
const GENERIC_CONSUMABLE_PATTERN =
  /(brush|filter|sensor_dirty|mop|pad|detergent|dust_bag|wheel)/;
const CONSUMABLE_UNITS = ['%', 'h', 'min', 's'];

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
      .filter((entry) => entry.device_id === deviceId && !entry.hidden)
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

export function findVacuumEntities(
  hass: ExtendedHomeAssistant,
  config: Pick<VacuumCardConfig, 'entity' | 'valetudo'>,
): DetectedEntities {
  const vacuumId = config.entity;
  const deviceId = hass.entities?.[vacuumId]?.device_id;
  const device = deviceId ? hass.devices?.[deviceId] : undefined;
  const deviceName = device?.name_by_user ?? device?.name ?? '';

  const isValetudo =
    config.valetudo !== false &&
    (device?.manufacturer === 'Valetudo' ||
      vacuumId.startsWith('vacuum.valetudo_'));

  const candidates = relatedEntityIds(hass, vacuumId, device?.id);
  const find = (domain: string, suffix: string) =>
    findBySuffix(candidates, vacuumId, domain, suffix);

  if (!isValetudo) {
    return findGenericEntities(hass, vacuumId, deviceName, candidates, find);
  }

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
    deviceName,
    valetudo: true,
    battery: find('sensor', 'battery_level'),
    error: find('sensor', 'error'),
    statusFlag: find('sensor', 'status_flag'),
    selects: [find('select', 'mode'), find('select', 'water')].filter(
      (id): id is string => !!id,
    ),
    currentTime: find('sensor', 'current_statistics_time'),
    currentArea: find('sensor', 'current_statistics_area'),
    consumables,
  };
}

function findGenericEntities(
  hass: ExtendedHomeAssistant,
  vacuumId: string,
  deviceName: string,
  candidates: string[],
  find: (domain: string, suffix: string) => string | undefined,
): DetectedEntities {
  const sensors = candidates.filter((id) => id.startsWith('sensor.'));
  const battery = sensors.find(
    (id) => hass.states[id].attributes.device_class === 'battery',
  );
  const currentTime = find('sensor', 'cleaning_time');
  const currentArea = find('sensor', 'cleaning_area');
  const excluded = new Set([battery, currentTime, currentArea]);

  const consumables = sensors.filter((id) => {
    const unit = hass.states[id].attributes.unit_of_measurement;
    return (
      !excluded.has(id) &&
      typeof unit === 'string' &&
      CONSUMABLE_UNITS.includes(unit) &&
      GENERIC_CONSUMABLE_PATTERN.test(objectId(id))
    );
  });

  return {
    vacuum: vacuumId,
    deviceName,
    valetudo: false,
    battery,
    selects: candidates.filter(
      (id) => id.startsWith('select.') || id.startsWith('input_select.'),
    ),
    currentTime,
    currentArea,
    consumables,
  };
}

export function getDefaultSelects(
  hass: ExtendedHomeAssistant,
  entity: string,
  detected: DetectedEntities | null,
): string[] {
  const fanSpeeds = hass.states[entity]?.attributes.fan_speed_list;
  return [
    ...(Array.isArray(fanSpeeds) && fanSpeeds.length ? [entity] : []),
    ...(detected?.selects ?? []),
  ];
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

function durationStat(
  hass: ExtendedHomeAssistant,
  entityId: string,
  target: 'h' | 'min',
): Pick<VacuumCardStat, 'unit' | 'value_template'> {
  const unit = hass.states[entityId]?.attributes.unit_of_measurement;
  const divisors: Record<string, Record<string, number>> = {
    h: { s: 3600, min: 60, h: 1 },
    min: { s: 60, min: 1 },
  };
  const divisor = typeof unit === 'string' ? divisors[target][unit] : undefined;
  if (!divisor) {
    return typeof unit === 'string' ? { unit } : {};
  }
  if (divisor === 1) {
    return { unit: target };
  }
  const rounding = target === 'h' ? 'round(1)' : 'round(0) | int';
  return {
    unit: target,
    value_template: `{{ (value | float(0) / ${divisor}) | ${rounding} }}`,
  };
}

export function getDetectedStats(
  hass: ExtendedHomeAssistant,
  detected: DetectedEntities,
  labels: { cleaningTime: string; cleanedArea: string },
): VacuumCardStat[] {
  const consumableStats = detected.consumables.map((entity_id) => ({
    entity_id,
    ...durationStat(hass, entity_id, 'h'),
    subtitle: stripDeviceName(hass, entity_id, detected.deviceName),
  }));

  const cleaningStats: VacuumCardStat[] = [];
  if (detected.currentTime) {
    cleaningStats.push({
      entity_id: detected.currentTime,
      ...(detected.valetudo
        ? {
            value_template: '{{ (value | float(0) / 60) | round(0) | int }}',
            unit: 'min',
          }
        : durationStat(hass, detected.currentTime, 'min')),
      subtitle: labels.cleaningTime,
      states: ['cleaning'],
    });
  }
  if (detected.currentArea) {
    const unit =
      hass.states[detected.currentArea]?.attributes.unit_of_measurement;
    cleaningStats.push({
      entity_id: detected.currentArea,
      ...(detected.valetudo
        ? {
            value_template: '{{ (value | float(0) / 10000) | round(1) }}',
            unit: 'm²',
          }
        : typeof unit === 'string'
          ? { unit }
          : {}),
      subtitle: labels.cleanedArea,
      states: ['cleaning'],
    });
  }

  const notCleaning = cleaningStats.length
    ? VACUUM_STATES.filter((state) => state !== 'cleaning')
    : undefined;
  return [
    ...consumableStats.map((stat) =>
      notCleaning ? { ...stat, states: notCleaning } : stat,
    ),
    ...cleaningStats,
  ];
}

export function getDetectedDefaults(
  hass: ExtendedHomeAssistant,
  detected: DetectedEntities,
  labels: { cleaningTime: string; cleanedArea: string },
): Partial<Pick<VacuumCardConfig, 'battery_entity' | 'stats'>> {
  const defaults: Partial<Pick<VacuumCardConfig, 'battery_entity' | 'stats'>> =
    {};
  if (
    detected.battery &&
    hass.states[detected.vacuum]?.attributes.battery_level == null
  ) {
    defaults.battery_entity = detected.battery;
  }
  const stats = getDetectedStats(hass, detected, labels);
  if (stats.length) {
    defaults.stats = stats;
  }
  return defaults;
}
