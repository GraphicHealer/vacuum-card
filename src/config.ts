import localize from './localize';
import { VacuumCardConfig, VacuumCardStat } from './types';

export const VACUUM_STATES = [
  'cleaning',
  'docked',
  'idle',
  'paused',
  'returning',
  'error',
];

const CLEANING_STATES = ['on', 'auto', 'spot', 'edge', 'single_room'];

export const TOOLBAR_BUTTONS: Record<
  string,
  { icon: string; states: string[] }
> = {
  start: {
    icon: 'hass:play',
    states: ['docked', 'idle', 'paused', 'returning', 'error'],
  },
  pause: { icon: 'hass:pause', states: ['cleaning', 'returning'] },
  stop: { icon: 'hass:stop', states: ['cleaning'] },
  locate: { icon: 'mdi:map-marker', states: ['docked', 'idle', 'error'] },
  return_to_base: {
    icon: 'hass:home-map-marker',
    states: ['cleaning', 'paused', 'idle'],
  },
};

export const SHORTCUT_STATES = ['docked', 'idle', 'error'];

export function vacuumStateGroup(state: string): string {
  return CLEANING_STATES.includes(state) ? 'cleaning' : state;
}

export function isShownIn(
  state: string,
  states?: string[],
  fallback?: string[],
): boolean {
  const list = states ?? fallback;
  return (
    !list || list.includes(state) || list.includes(vacuumStateGroup(state))
  );
}

type LegacyStats = Record<string, VacuumCardStat[]>;

export function normalizeStats(
  stats?: VacuumCardStat[] | LegacyStats,
): VacuumCardStat[] | undefined {
  if (!stats || Array.isArray(stats)) {
    return stats;
  }

  const own = Object.keys(stats).filter((key) => key !== 'default');
  return Object.entries(stats).flatMap(([key, list]) => {
    const states =
      key !== 'default'
        ? [key]
        : own.length
          ? VACUUM_STATES.filter((state) => !own.includes(state))
          : undefined;
    return (Array.isArray(list) ? list : []).map((stat) =>
      states ? { ...stat, states } : stat,
    );
  });
}

export default function buildConfig(
  config?: Partial<VacuumCardConfig>,
): VacuumCardConfig {
  if (!config) {
    throw new Error(localize('error.invalid_config'));
  }

  if (!config.entity) {
    throw new Error(localize('error.missing_entity'));
  }

  const actions = config.actions;
  if (actions && Array.isArray(actions)) {
    console.warn(localize('warning.actions_array'));
  }

  return {
    entity: config.entity,
    battery_entity: config.battery_entity ?? '',
    selects: Array.isArray(config.selects) ? config.selects : undefined,
    valetudo: config.valetudo ?? true,
    map: config.map ?? '',
    map_refresh: config.map_refresh ?? 5,
    image: config.image ?? 'default',
    show_name: config.show_name ?? true,
    show_status: config.show_status ?? true,
    show_toolbar: config.show_toolbar ?? true,
    compact_view: config.compact_view ?? false,
    stats: normalizeStats(
      config.stats as VacuumCardStat[] | LegacyStats | undefined,
    ),
    actions: config.actions ?? {},
    shortcuts: config.shortcuts ?? [],
  };
}
