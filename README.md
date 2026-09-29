# Vacuum Card

[![hacs][hacs-image]][hacs-url]

> Vacuum cleaner card for [Home Assistant][home-assistant] Lovelace UI

This is a fork of [denysdovhan/vacuum-card][upstream], modified for better compatibility and more options with more vacuums, including [Valetudo][valetudo]: a visual editor for every option, status-based visibility for buttons, shortcuts and sensors, header dropdowns, multi-room cleaning from Home Assistant's area mapping, and auto-detection of the vacuum's related entities.

By default, Home Assistant does not provide any card for controlling vacuum cleaners. This card displays the state and allows to control your robot.

![Preview of vacuum-card][preview-image]

## Installing

### HACS

Add this repository to [HACS][hacs] (Home Assistant Community Store) as a custom repository:

1. In HACS, open the menu (⋮) and choose **Custom repositories**.
2. Enter `https://github.com/GraphicHealer/vacuum-card` and pick the **Dashboard** type.
3. Search for `Vacuum Card` and download it.

### Manual

1. Download `vacuum-card.js` file from the [latest-release].
2. Put `vacuum-card.js` file into your `config/www` folder.
3. Add reference to `vacuum-card.js` in Lovelace. There's two way to do that:
   1. **Using UI:** _Configuration_ → _Lovelace Dashboards_ → _Resources Tab_ → Click Plus button → Set _Url_ as `/local/vacuum-card.js` → Set _Resource type_ as `JavaScript Module`.
      **Note:** If you do not see the Resources Tab, you will need to enable _Advanced Mode_ in your _User Profile_
   2. **Using YAML:** Add following code to `lovelace` section.

      ```yaml
      resources:
        - url: /local/vacuum-card.js
          type: module
      ```

4. Add `custom:vacuum-card` to Lovelace UI as any other card (using either editor or YAML configuration).

## Usage

This card can be configured using Lovelace UI editor.

1. In Lovelace UI, click 3 dots in top left corner.
2. Click _Configure UI_.
3. Click Plus button to add a new card.
4. Find _Custom: Vacuum Card_ in the list.
5. Choose `entity`.
6. Optionally pick a battery sensor and map camera, and edit the collapsible **Header Dropdowns** (fan speed, plus `select` entities such as cleaning mode or water level), **Sensors** (stats), **Shortcuts** and **Toolbar Actions** sections, each item with its own name, icon, options and visibility. Header Dropdowns and Sensors have an **Add entity** button that opens the entity picker.
7. Now you should see the preview of the card!

For any vacuum, the editor writes everything it detects into the card config, so you can edit or remove any of it in the editor or in YAML. It looks at the entities on the vacuum's device:

| Detected entity                                                                                                  | Used for                         | Written to       |
| ---------------------------------------------------------------------------------------------------------------- | -------------------------------- | ---------------- |
| Sensor with `device_class: battery` (only if the vacuum has no `battery_level` attribute)                        | Battery level and icon           | `battery_entity` |
| The vacuum itself (if it has a `fan_speed_list`)                                                                 | Fan speed dropdown               | `selects`        |
| Every `select` / `input_select` entity                                                                           | Header dropdowns                 | `selects`        |
| Consumable sensors (brush, filter, sensor_dirty, mop, pad, detergent, dust_bag, wheel) in `%`, `h`, `min` or `s` | Sensors shown while not cleaning | `stats`          |
| `sensor.*_cleaning_time` / `sensor.*_cleaning_area`                                                              | Sensors shown while cleaning     | `stats`          |

Every `select` on the device is added, which may include ones you don't want (e.g. a map selector); remove them in the editor. Valetudo robots get [more specific detection](#valetudo).

Shortcuts use Home Assistant's action picker: choose an action (e.g. `mqtt.publish`) and its fields and target are shown for you to fill in. It is saved in the same `action` / `data` / `target` format as automations.

The collapsible **Toolbar Actions** section sets what the main buttons (clean / continue, pause, stop, locate, return to base) do and when they show. The editor fills each one with its standard vacuum action (e.g. `vacuum.start` targeting your vacuum) and the vacuum statuses it normally shows for, so you can change both. A button whose action is cleared falls back to the standard vacuum action.

Drag the handle next to any sensor, header dropdown, room, shortcut or toolbar action to reorder it. The new order is saved to the YAML (list order for `stats`, `selects`, `rooms` and `shortcuts`, key order for `actions`), and the card shows them in that order.

Toolbar actions, sensors, rooms and shortcuts each have a **Show when status is** checklist (`states` in YAML) with the vacuum statuses `cleaning`, `docked`, `idle`, `paused`, `returning` and `error`. Integration-specific cleaning states such as `on`, `auto`, `spot`, `edge` or `single_room` count as `cleaning`. An empty list (`states: []`) hides the item.

Typical example of using this card in YAML config would look like this:

```yaml
type: 'custom:vacuum-card'
entity: vacuum.vacuum_cleaner
battery_entity: sensor.vacuum_cleaner_battery
selects:
  - entity: vacuum.vacuum_cleaner
    icon: mdi:fan
  - select.vacuum_cleaner_mode
  - select.vacuum_cleaner_water
map: camera.vacuum_cleaner_map
actions:
  start:
    action: xiaomi_miio.vacuum_clean_segment
    data:
      entity_id: vacuum.vacuum_cleaner
      segments: [16, 20]
    states:
      - docked
      - idle
      - paused
stats:
  - attribute: filter_left
    unit: hours
    subtitle: Filter
  - attribute: side_brush_left
    unit: hours
    subtitle: Side brush
  - entity_id: sensor.vacuum_main_brush_left
    value_template: '{{ (value | float(0) / 3600) | round(1) }}'
    unit: hours
    subtitle: Main brush
  - attribute: cleaning_time
    unit: minutes
    subtitle: Cleaning time
    states:
      - cleaning
shortcuts:
  - name: Clean living room
    action: script.clean_living_room
    icon: 'mdi:sofa'
  - name: Clean bedroom
    action: script.clean_bedroom
    icon: 'mdi:bed-empty'
  - name: Clean kitchen
    action: script.clean_kitchen
    icon: 'mdi:silverware-fork-knife'
```

Here is what every option means:

| Name             |   Type    | Default      | Description                                                                               |
| ---------------- | :-------: | ------------ | ----------------------------------------------------------------------------------------- |
| `type`           | `string`  | **Required** | `custom:vacuum-card`                                                                      |
| `entity`         | `string`  | **Required** | An entity_id within the `vacuum` domain.                                                  |
| `battery_entity` | `string`  | Optional     | An entity_id within the `sensor` domain to display battery state and icon.                |
| `selects`        |  `array`  | Optional     | [Header dropdowns](#header-dropdowns-selects) (fan speed, cleaning mode, water, …).       |
| `map`            | `string`  | Optional     | An entity_id within the `camera` or `image` domain, for streaming live vacuum map.        |
| `map_refresh`    | `integer` | `5`          | Update interval for map camera in seconds                                                 |
| `image`          | `string`  | `default`    | Path to image of your vacuum cleaner. Better to have `png` or `svg`.                      |
| `show_name`      | `boolean` | `true`       | Show friendly name of the vacuum.                                                         |
| `show_status`    | `boolean` | `true`       | Show status of the vacuum.                                                                |
| `show_toolbar`   | `boolean` | `true`       | Show toolbar with actions.                                                                |
| `compact_view`   | `boolean` | `false`      | Compact view without image.                                                               |
| `stats`          |  `array`  | Optional     | Stats (sensors) for your vacuum cleaner, each optionally limited to some vacuum statuses. |
| `actions`        | `object`  | Optional     | Override what the toolbar buttons do and when they show.                                  |
| `rooms`          |  `array`  | Optional     | [Room toggles](#rooms) shown below the toolbar, cleaned together with the Clean button.   |
| `shortcuts`      |  `array`  | Optional     | List of shortcuts shown below the rooms with custom actions for your vacuum cleaner.      |
| `valetudo`       | `boolean` | `true`       | Valetudo-specific auto-detection. Set `false` to use the generic detection instead.       |

### Header dropdowns (`selects`)

Each item in `selects` is rendered as a dropdown in the header. Use it for things like fan speed, cleaning mode (vacuum / mop / vacuum and mop), water level or mop intensity. Options are read live from the entity's `options` attribute and the icon comes from the entity itself, so any integration's options work. Picking an option calls `select.select_option` (or `input_select.select_option`).

An item pointing at a `vacuum` entity is the fan speed dropdown: its options come from the vacuum's `fan_speed_list`, it defaults to the `mdi:fan` icon, and picking one calls `vacuum.set_fan_speed`.

An item is either an entity_id or an object:

| Name      |   Type   | Default      | Description                                                                   |
| --------- | :------: | ------------ | ----------------------------------------------------------------------------- |
| `entity`  | `string` | **Required** | A `select` / `input_select` entity_id, or a `vacuum` entity_id for fan speed. |
| `name`    | `string` | Entity name  | Tooltip and accessible label of the dropdown.                                 |
| `icon`    | `string` | Entity icon  | Icon shown on the dropdown button.                                            |
| `options` | `array`  | All options  | Only show these options (values from the entity's `options`).                 |

```yaml
type: custom:vacuum-card
entity: vacuum.robot
selects:
  - entity: vacuum.robot
    options:
      - quiet
      - turbo
  - entity: select.robot_mode
    icon: mdi:robot-vacuum
    options:
      - vacuum
      - vacuum_and_mop
  - select.robot_water
```

- Leave `selects` out to use the auto-detected dropdowns: fan speed (if the vacuum has fan speeds) plus the vacuum device's `select` entities (for Valetudo, only mode and water; see below). The visual editor writes them into `selects` so you can edit or remove them.
- List only the entities you want to show; anything not listed is hidden.
- `selects: []` hides all select dropdowns.
- A select whose entity doesn't exist or has no options is not shown.

### Valetudo

[Valetudo][valetudo] robots connected through MQTT with Home Assistant autodiscovery are detected automatically: either the device manufacturer is `Valetudo` or the entity id starts with `vacuum.valetudo_`. The minimal config is just:

```yaml
type: custom:vacuum-card
entity: vacuum.valetudo_robot
```

The card then uses these entities from the same device, if the robot has them:

| Valetudo entity                                 | Used for                                                              | Override with    |
| ----------------------------------------------- | --------------------------------------------------------------------- | ---------------- |
| `sensor.*_battery_level`                        | Battery level and icon                                                | `battery_entity` |
| `select.*_mode`, `select.*_water`               | Mode and water dropdowns                                              | `selects`        |
| `sensor.*_error`, `sensor.*_status_flag`        | More detailed status (e.g. _Segment cleaning_, the actual error text) | —                |
| Consumable sensors (`mdi:progress-wrench`)      | Sensors while not cleaning (hours / % remaining)                      | `stats`          |
| The vacuum's fan speeds                         | Fan speed dropdown                                                    | `selects`        |
| `sensor.*_current_statistics_time` / `..._area` | Sensors while cleaning (minutes, m²)                                  | `stats`          |

Anything you configure explicitly takes precedence. The visual editor writes the detected `battery_entity`, `selects` and `stats` into the card config, so you can change icons, names and options or remove items. Use `selects: []` or `stats: []` to show none; if a key is left out entirely, the card falls back to auto-detection.

Set `valetudo: false` to use the generic detection described under [Usage](#usage) instead.

### Rooms

The card shows three rows below the vacuum: the toolbar controls, then room toggles (`rooms`), then regular shortcuts (`shortcuts`).

Room buttons are toggles and don't start cleaning by themselves. Select one or more rooms, then press **Clean**: the card calls `vacuum.clean_area` with the selected areas (in the order of the `rooms` list) and turns all toggles off again. With no rooms selected, **Clean** does its normal action. Rooms are shown whenever the Clean button is, unless you set their own `states`.

| Name     |   Type   | Default      | Description                                                             |
| -------- | :------: | ------------ | ----------------------------------------------------------------------- |
| `area`   | `string` | **Required** | Home Assistant area id, i.e. `living_room`.                             |
| `name`   | `string` | Area name    | Tooltip and accessible label of the toggle.                             |
| `icon`   | `string` | Area icon    | Icon of the toggle.                                                     |
| `states` | `array`  | Optional     | Vacuum statuses to show the toggle for. Defaults to the Clean button's. |

```yaml
rooms:
  - area: living_room
    name: Living Room
    icon: mdi:sofa
  - area: kitchen
    name: Kitchen
    icon: mdi:stove
```

For any vacuum that supports Home Assistant's area cleaning (`vacuum.clean_area`), including Valetudo, the visual editor fills `rooms` automatically with every Home Assistant area the vacuum's segments are mapped to, named and iconed after that area, like it does for other detected entities. Existing `vacuum.clean_area` shortcuts for a single area are moved from `shortcuts` into `rooms`, keeping their icon. To detect the rooms again, delete `rooms` from the YAML and reopen the editor.

If any segment isn't mapped to an area, a **Please map rooms** error at the top of the editor lists them with instructions. **Open vacuum settings** opens the vacuum's settings, where you pick **Map vacuum segments to areas** and save. When you close the settings, the editor checks the mapping again, adds any newly mapped areas to `rooms` and hides the error once every segment is mapped.

### `stats` array

You can use any attribute of vacuum or even any entity by `entity_id` to display by stats section. You can also combine `attribute` with `entity_id` to extract an attribute value of specific entity. Use `states` to show a stat only for some vacuum statuses; without it the stat is always shown. In the visual editor this is the **Sensors** list. The old grouped format (`stats: { default: [...], cleaning: [...] }`) is still read and converted to a list with `states`.

| Name             |   Type   | Default  | Description                                                                                          |
| ---------------- | :------: | -------- | ---------------------------------------------------------------------------------------------------- |
| `entity_id`      | `string` | Optional | An entity_id with state, i.e. `sensor.vacuum`.                                                       |
| `attribute`      | `string` | Optional | Attribute name of the stat, i.e. `filter_left`.                                                      |
| `value_template` | `string` | Optional | Jinja2 template returning a value. `value` variable represents the `entity_id` or `attribute` state. |
| `unit`           | `string` | Optional | Unit of measure, i.e. `hours`.                                                                       |
| `subtitle`       | `string` | Optional | Friendly name of the stat, i.e. `Filter`.                                                            |
| `icon`           | `string` | Optional | Icon shown above the value, i.e. `mdi:air-filter`.                                                   |
| `states`         | `array`  | Optional | Vacuum statuses to show the stat for, i.e. `[cleaning]`. Always shown if omitted.                    |

### `actions` object

You can define action calls to override default actions behavior. Available actions to override are `start` (also shown as Continue while paused or returning), `pause`, `stop`, `locate` and `return_to_base`. They use the same `action` / `data` / `target` format as automations, and the visual editor pre-fills them with the standard vacuum actions. The order of the keys is the order of the buttons in the toolbar; buttons you leave out keep their default position after the listed ones.

```yaml
actions:
  start:
    action: vacuum.start
    target:
      entity_id: vacuum.robot
    states:
      - docked
      - idle
```

| Name     |   Type   | Default  | Description                                                                                                                                                                                                                  |
| -------- | :------: | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `action` | `string` | Optional | An action to call, i.e. `script.clean_bedroom`. Defaults to the standard vacuum action.                                                                                                                                      |
| `states` | `array`  | Optional | Vacuum statuses to show the button for; `[]` hides it. Defaults: `start` docked/idle/paused/returning/error, `pause` cleaning/returning, `stop` cleaning, `locate` docked/idle/error, `return_to_base` cleaning/paused/idle. |
| `data`   | `object` | Optional | Data for the action call.                                                                                                                                                                                                    |
| `target` | `object` | Optional | A `HassServiceTarget`, to define a target for the action call.                                                                                                                                                               |

### `shortcuts` object

Shortcuts are buttons for any action, e.g. [scripts][ha-scripts]. They use the same `action` / `data` / `target` format as automations; the old `service` / `service_data` keys are no longer supported.

| Name     |   Type   | Default  | Description                                                                   |
| -------- | :------: | -------- | ----------------------------------------------------------------------------- |
| `name`   | `string` | Optional | Friendly name of the action, i.e. `Clean bedroom`.                            |
| `action` | `string` | Optional | An action to call, i.e. `script.clean_bedroom`.                               |
| `data`   | `object` | Optional | Data for the action call.                                                     |
| `target` | `object` | Optional | A `HassServiceTarget`, to define a target for the action call.                |
| `icon`   | `string` | Optional | Any icon for action button.                                                   |
| `states` | `array`  | Optional | Vacuum statuses to show the shortcut for. Defaults to docked, idle and error. |

## Theming

This card can be styled by changing the values of these CSS properties (globally or per-card via [`card-mod`][card-mod]):

| Variable                    | Default value                                                          | Description                                         |
| --------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------- |
| `--vc-background`           | `var(--ha-card-background, var(--card-background-color, transparent))` | Card background.                                    |
| `--vc-primary-text-color`   | `var(--primary-text-color)`                                            | Vacuum name, stats values, etc.                     |
| `--vc-secondary-text-color` | `var(--secondary-text-color)`                                          | Status, stats units and titles, etc.                |
| `--vc-icon-color`           | `var(--secondary-text-color)`                                          | Colors of icons.                                    |
| `--vc-toolbar-background`   | `transparent`                                                          | Toolbar background (transparent to avoid stacking). |
| `--vc-toolbar-text-color`   | `var(--secondary-text-color)`                                          | Color of the toolbar texts.                         |
| `--vc-toolbar-icon-color`   | `var(--secondary-text-color)`                                          | Color of the toolbar icons.                         |
| `--vc-divider-color`        | `var(--entities-divider-color, var(--divider-color))`                  | Color of dividers.                                  |
| `--vc-spacing`              | `10px`                                                                 | Paddings and margins inside the card.               |

### Styling via theme

Here is an example of customization via theme. Read more in the [Frontend documentation](https://www.home-assistant.io/integrations/frontend/).

```yaml
my-custom-theme:
  vc-background: '#17A8F4'
  vc-spacing: 5px
```

### Styling via card-mod

You can use [`card-mod`][card-mod] to customize the card on per-card basis, like this:

```yaml
type: 'custom:vacuum-card'
style: |
  ha-card {
    --vc-background: #17A8F4;
    --vc-spacing: 5px;
  }
  ...
```

## Animations

I've added some animations for this card to make it alive. Animations are applied only for `image` property. Here's how they look like:

|              Cleaning               |                Docking                |
| :---------------------------------: | :-----------------------------------: |
| ![Cleaning anumation][cleaning-gif] | ![Returning anumation][returning-gif] |

## Supported languages

This card supports translations. Please, help to add more translations and improve existing ones. Here's a list of supported languages:

- English
- Українська (Ukrainian)
- Deutsch (German)
- Français (French)
- Italiano (Italian)
- Nederlands (Dutch)
- Polski (Polish)
- Русский (Russian)
- Español (Spanish)
- Čeština (Czech)
- Magyar (Hungarian)
- עִבְרִית (Hebrew)
- Português (Portuguese)
- Português Brasileiro (Brazilian Portuguese)
- Svenska (Swedish)
- Norsk bokmål (Norwegian)
- Norsk nynorsk (Norwegian)
- Dansk (Danish)
- 한국어 (Korean)
- Suomi (Finnish)
- Català (Catalan)
- 正體中文 (Traditional Chinese)
- Việt Nam (Vietnamese)
- Lietuvių (Lithuanian)
- Română (Romanian)
- Slovensky (Slovak)
- 简体中文 (Simplified Chinese)
- 日本語 (Japanese)
- [_Your language?_][add-translation]

## Supported models

This card relies on basic vacuum services, like `pause`, `start`, `stop`, `return_to_base`, etc. It should work with any robot vacuum, however I can physically test it only with my own robot vacuum.

If this card works with your vacuum cleaner, please open a PR and your model to the list.

- **Roborock** S8 (MaxV Ultra, Ultra Pro), S7 (MaxV), S6 (MaxV, Pure), S5 (Max), S50, S4 (Max), E25, E4, Q5 Pro, Qrevo S
- **Mijia** Robot Vacuum Cleaner 1C (STYTJ01ZHM)
- **Xiaomi** Mi Robot (STYJ02YM), Mi Robot 1S, Mi Roborock V1 (SDJQR02RR), Mijia 1C, Mi Robot Vacuum-Mop P, Robot Vacuum E10
- **Roomba** 670, 675, 676, 697, 960, 980, 981, i3, i7+, e5, S9, s9+, j7
- **Braava** M6
- **Dyson** 360 Eye
- **Neato** D7, D6, D4
- **Shark** IQ
- **Eufy** Robovac 30c, Robovac 35c, Robovac 15C Max, Robovac L70 Hybrid, Robovac X8, Robovac X8 Hybrid, Robovac G40
- **EcoVacs** T9 AIVI, Deebot 950, Deebot OZMO T8 AIVI, Deebot N79, Deebot N8, Deebot N8+, T9 AIVI, Deebot T20 Ombi, Deebot X8 PRO OMN
- **Dreame** Z10 Pro, L10 Pro, D9, F9
- **Valetudo**: any robot running [Valetudo][valetudo] ([GitHub](https://github.com/hypfer/valetudo)), e.g. rooted Dreame and Roborock models, with [auto-detection](#valetudo) of its extra entities
- 360 S7 Pro
- KaBum! Smart 500
- Honiture Q6 Lite
- Neabot NoMo N1 Plus
- Kyvol E31
- Setti+ RV800
- [_Your vacuum?_][edit-readme]

## Development

Want to contribute to the project?

First of all, thanks! Check [contributing guideline](./CONTRIBUTING.md) for more information.

## Inspiration

This project is heavily inspired by:

- [MacBury Smart House][macbury-smart-house] — basically, this project is a refinement of MacBury's custom card.
- [Benji][bbbenji-card] vacuum card — this is where I noticed this vacuum card design for the [first time](https://github.com/bbbenji/synthwave-hass/issues/29).

Huge thanks for their ideas and efforts 👍

## License

MIT © [Denys Dovhan][denysdovhan], modified by [GraphicHealer][graphichealer]

<!-- Badges -->

[hacs-url]: https://github.com/hacs/integration
[hacs-image]: https://img.shields.io/badge/hacs-custom-orange.svg?style=flat-square

<!-- References -->

[valetudo]: https://valetudo.cloud/
[home-assistant]: https://www.home-assistant.io/
[hacs]: https://hacs.xyz
[preview-image]: https://github.com/denysdovhan/vacuum-card/assets/3459374/43808d3d-65a4-4e65-9531-4f248fa8861c
[cleaning-gif]: https://user-images.githubusercontent.com/3459374/81119202-fa60b500-8f32-11ea-9b23-325efa93d7ab.gif
[returning-gif]: https://user-images.githubusercontent.com/3459374/81119452-765afd00-8f33-11ea-9dc5-9c26ba3f8c45.gif
[latest-release]: https://github.com/GraphicHealer/vacuum-card/releases/latest
[ha-scripts]: https://www.home-assistant.io/docs/scripts/
[edit-readme]: https://github.com/GraphicHealer/vacuum-card/edit/main/README.md
[card-mod]: https://github.com/thomasloven/lovelace-card-mod
[add-translation]: https://github.com/GraphicHealer/vacuum-card/blob/main/CONTRIBUTING.md#how-to-add-translation
[macbury-smart-house]: https://macbury.github.io/SmartHouse/HomeAssistant/Vacuum/
[bbbenji-card]: https://gist.github.com/bbbenji/24372e423f8669b2e6713638d8f8ceb2
[denysdovhan]: https://denysdovhan.com
[graphichealer]: https://github.com/GraphicHealer
[upstream]: https://github.com/denysdovhan/vacuum-card
