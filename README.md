[![SWUbanner](https://raw.githubusercontent.com/vshymanskyy/StandWithUkraine/main/banner-direct-single.svg)](https://stand-with-ukraine.pp.ua/)

# Vacuum Card

[![npm version][npm-image]][npm-url]
[![hacs][hacs-image]][hacs-url]
[![GitHub Sponsors][gh-sponsors-image]][gh-sponsors-url]
[![Patreon][patreon-image]][patreon-url]
[![Buy Me A Coffee][buymeacoffee-image]][buymeacoffee-url]
[![Twitter][twitter-image]][twitter-url]

> Vacuum cleaner card for [Home Assistant][home-assistant] Lovelace UI

By default, Home Assistant does not provide any card for controlling vacuum cleaners. This card displays the state and allows to control your robot.

![Preview of vacuum-card][preview-image]

## Installing

**💡 Tip:** If you like this project, consider giving me a tip for the time I spent building this project:

<a href="https://www.buymeacoffee.com/denysdovhan" target="_blank">
  <img src="https://cdn.buymeacoffee.com/buttons/default-black.png" alt="Buy Me A Coffee" width="150px">
</a>

### HACS

This card is available in [HACS][hacs] (Home Assistant Community Store).

Just search for `Vacuum Card` in plugins tab.

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
6. Optionally pick a battery sensor and map camera, add **Header Dropdowns** (`select` entities such as cleaning mode or water level, shown next to fan speed), **Sensors** (stats) and **Shortcuts**, each with its own name, icon and options.
7. Now you should see the preview of the card!

For a Valetudo vacuum, the editor writes everything it detects (battery sensor, header dropdowns and sensors) into the card config, so you can edit or remove any of it in the editor or in YAML.

Shortcuts use Home Assistant's action picker: choose an action (e.g. `mqtt.publish`) and its fields and target are shown for you to fill in. It is saved in the same `action` / `data` / `target` format as automations.

The collapsible **Toolbar Actions** section sets what the main buttons (start, pause, resume, stop, locate, return to base) do. The editor fills each one with its standard vacuum action (e.g. `vacuum.start` targeting your vacuum), so you can change it with the same action picker. A button whose action is cleared falls back to the standard vacuum action.

Typical example of using this card in YAML config would look like this:

```yaml
type: 'custom:vacuum-card'
entity: vacuum.vacuum_cleaner
battery_entity: sensor.vacuum_cleaner_battery
selects:
  - select.vacuum_cleaner_mode
  - select.vacuum_cleaner_water
map: camera.vacuum_cleaner_map
actions:
  start:
    action: xiaomi_miio.vacuum_clean_segment
    data:
      entity_id: vacuum.vacuum_cleaner
      segments: [16, 20]
stats:
  default:
    - attribute: filter_left
      unit: hours
      subtitle: Filter
    - attribute: side_brush_left
      unit: hours
      subtitle: Side brush
    - attribute: main_brush_left
      unit: hours
      subtitle: Main brush
    - attribute: sensor_dirty_left
      unit: hours
      subtitle: Sensors
  cleaning:
    - entity_id: sensor.vacuum_main_brush_left
      value_template: '{{ (value | float(0) / 3600) | round(1) }}'
      subtitle: Main brush
      unit: hours
    - attribute: cleaning_time
      unit: minutes
      subtitle: Cleaning time
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

| Name             |   Type    | Default      | Description                                                                                               |
| ---------------- | :-------: | ------------ | --------------------------------------------------------------------------------------------------------- |
| `type`           | `string`  | **Required** | `custom:vacuum-card`                                                                                      |
| `entity`         | `string`  | **Required** | An entity_id within the `vacuum` domain.                                                                  |
| `battery_entity` | `string`  | Optional     | An entity_id within the `sensor` domain to display battery state and icon.                                |
| `selects`        |  `array`  | Optional     | [Header dropdowns](#header-dropdowns-selects) next to fan speed (e.g. cleaning mode, water).              |
| `map`            | `string`  | Optional     | An entity_id within the `camera` or `image` domain, for streaming live vacuum map.                        |
| `map_refresh`    | `integer` | `5`          | Update interval for map camera in seconds                                                                 |
| `image`          | `string`  | `default`    | Path to image of your vacuum cleaner. Better to have `png` or `svg`.                                      |
| `show_name`      | `boolean` | `true`       | Show friendly name of the vacuum.                                                                         |
| `show_status`    | `boolean` | `true`       | Show status of the vacuum.                                                                                |
| `show_toolbar`   | `boolean` | `true`       | Show toolbar with actions.                                                                                |
| `compact_view`   | `boolean` | `false`      | Compact view without image.                                                                               |
| `stats`          | `object`  | Optional     | Custom per state stats for your vacuum cleaner                                                            |
| `actions`        | `object`  | Optional     | Override default actions behavior with service invocations.                                               |
| `shortcuts`      |  `array`  | Optional     | List of shortcuts shown at the right bottom part of the card with custom actions for your vacuum cleaner. |
| `valetudo`       | `boolean` | `true`       | Valetudo auto-detection. Set `false` to disable.                                                          |

### Header dropdowns (`selects`)

Each item in `selects` is rendered as a dropdown in the header, next to fan speed. Use it for things like cleaning mode (vacuum / mop / vacuum and mop), water level or mop intensity. Options are read live from the entity's `options` attribute and the icon comes from the entity itself, so any integration's options work. Picking an option calls `select.select_option` (or `input_select.select_option`).

An item is either an entity_id or an object:

| Name      |   Type   | Default      | Description                                                   |
| --------- | :------: | ------------ | ------------------------------------------------------------- |
| `entity`  | `string` | **Required** | A `select` / `input_select` entity_id.                        |
| `name`    | `string` | Entity name  | Tooltip and accessible label of the dropdown.                 |
| `icon`    | `string` | Entity icon  | Icon shown on the dropdown button.                            |
| `options` | `array`  | All options  | Only show these options (values from the entity's `options`). |

```yaml
type: custom:vacuum-card
entity: vacuum.robot
selects:
  - entity: select.robot_mode
    icon: mdi:robot-vacuum
    options:
      - vacuum
      - vacuum_and_mop
  - select.robot_water
```

- Leave `selects` out to use auto-detected selects (Valetudo only, see below).
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
| `select.*_mode`, `select.*_water`               | Mode and water dropdowns next to fan speed                            | `selects`        |
| `sensor.*_error`, `sensor.*_status_flag`        | More detailed status (e.g. _Segment cleaning_, the actual error text) | —                |
| Consumable sensors (`mdi:progress-wrench`)      | Default stats (hours / % remaining)                                   | `stats`          |
| `sensor.*_current_statistics_time` / `..._area` | Stats while cleaning (minutes, m²)                                    | `stats`          |

Anything you configure explicitly takes precedence. The visual editor writes the detected `battery_entity`, `selects` and `stats` into the card config, so you can change icons, names and options or remove items. Use `selects: []` or `stats: {}` to show none; if a key is left out entirely, the card falls back to auto-detection.

Set `valetudo: false` to turn off auto-detection completely.

### Room shortcuts

For any vacuum that supports Home Assistant's area cleaning (`vacuum.clean_area`), including Valetudo, the visual editor shows a **Generate Room Shortcuts** button below the **Shortcuts** list. It adds one [shortcut](#shortcuts-object) per Home Assistant area the vacuum's segments are mapped to, named and iconed after that area.

If any segment isn't mapped to an area yet, a pop-up lists them and explains how to map them. **Continue** opens the vacuum's settings, where you pick **Map vacuum segments to areas** and save. When you close the settings, the editor checks the mapping again: if everything is mapped the shortcuts are generated, otherwise a _"The locations are not mapped. Please try again."_ pop-up offers **Try Again** (reopens the settings) or **Cancel**.

Areas that already have a shortcut (a `vacuum.clean_area` shortcut for just that area, whether generated earlier or written by hand) are skipped, so clicking it again only adds new areas and never duplicates or changes existing shortcuts.

Each generated shortcut looks like this:

```yaml
shortcuts:
  - name: Clean Living Room
    icon: mdi:sofa
    action: vacuum.clean_area
    target:
      entity_id: vacuum.robot
    data:
      cleaning_area_id:
        - living_room
```

### `stats` object

You can use any attribute of vacuum or even any entity by `entity_id` to display by stats section. You can also combine `attribute` with `entity_id` to extract an attribute value of specific entity. Stats are grouped by vacuum state (e.g. `cleaning`); `default` is used for any state without its own list. In the visual editor these are the **Sensors** lists.

| Name             |   Type   | Default  | Description                                                                                          |
| ---------------- | :------: | -------- | ---------------------------------------------------------------------------------------------------- |
| `entity_id`      | `string` | Optional | An entity_id with state, i.e. `sensor.vacuum`.                                                       |
| `attribute`      | `string` | Optional | Attribute name of the stat, i.e. `filter_left`.                                                      |
| `value_template` | `string` | Optional | Jinja2 template returning a value. `value` variable represents the `entity_id` or `attribute` state. |
| `unit`           | `string` | Optional | Unit of measure, i.e. `hours`.                                                                       |
| `subtitle`       | `string` | Optional | Friendly name of the stat, i.e. `Filter`.                                                            |
| `icon`           | `string` | Optional | Icon shown above the value, i.e. `mdi:air-filter`.                                                   |

### `actions` object

You can define action calls to override default actions behavior. Available actions to override are `start`, `pause`, `resume`, `stop`, `locate` and `return_to_base`. They use the same `action` / `data` / `target` format as automations, and the visual editor pre-fills them with the standard vacuum actions:

```yaml
actions:
  start:
    action: vacuum.start
    target:
      entity_id: vacuum.robot
```

| Name     |   Type   | Default      | Description                                                    |
| -------- | :------: | ------------ | -------------------------------------------------------------- |
| `action` | `string` | **Required** | An action to call, i.e. `script.clean_bedroom`.                |
| `data`   | `object` | Optional     | Data for the action call.                                      |
| `target` | `object` | Optional     | A `HassServiceTarget`, to define a target for the action call. |

### `shortcuts` object

You can defined [custom scripts][ha-scripts] for custom actions i.e cleaning specific room and add them to this card with `shortcuts` option.

| Name     |   Type   | Default  | Description                                                    |
| -------- | :------: | -------- | -------------------------------------------------------------- |
| `name`   | `string` | Optional | Friendly name of the action, i.e. `Clean bedroom`.             |
| `action` | `string` | Optional | An action to call, i.e. `script.clean_bedroom`.                |
| `data`   | `object` | Optional | Data for the action call.                                      |
| `target` | `object` | Optional | A `HassServiceTarget`, to define a target for the action call. |
| `icon`   | `string` | Optional | Any icon for action button.                                    |

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

MIT © [Denys Dovhan][denysdovhan]

<!-- Badges -->

[npm-url]: https://npmjs.org/package/vacuum-card
[npm-image]: https://img.shields.io/npm/v/vacuum-card.svg?style=flat-square
[hacs-url]: https://github.com/hacs/integration
[hacs-image]: https://img.shields.io/badge/hacs-default-orange.svg?style=flat-square
[gh-sponsors-url]: https://github.com/sponsors/denysdovhan
[gh-sponsors-image]: https://img.shields.io/github/sponsors/denysdovhan?style=flat-square
[patreon-url]: https://patreon.com/denysdovhan
[patreon-image]: https://img.shields.io/badge/support-patreon-F96854.svg?style=flat-square
[buymeacoffee-url]: https://patreon.com/denysdovhan
[buymeacoffee-image]: https://img.shields.io/badge/support-buymeacoffee-222222.svg?style=flat-square
[twitter-url]: https://x.com/denysdovhan
[twitter-image]: https://img.shields.io/badge/follow-%40denysdovhan-000000.svg?style=flat-square

<!-- References -->

[valetudo]: https://valetudo.cloud/
[home-assistant]: https://www.home-assistant.io/
[hacs]: https://hacs.xyz
[preview-image]: https://github.com/denysdovhan/vacuum-card/assets/3459374/43808d3d-65a4-4e65-9531-4f248fa8861c
[cleaning-gif]: https://user-images.githubusercontent.com/3459374/81119202-fa60b500-8f32-11ea-9b23-325efa93d7ab.gif
[returning-gif]: https://user-images.githubusercontent.com/3459374/81119452-765afd00-8f33-11ea-9dc5-9c26ba3f8c45.gif
[latest-release]: https://github.com/denysdovhan/vacuum-card/releases/latest
[ha-scripts]: https://www.home-assistant.io/docs/scripts/
[edit-readme]: https://github.com/denysdovhan/vacuum-card/edit/main/README.md
[card-mod]: https://github.com/thomasloven/lovelace-card-mod
[add-translation]: https://github.com/denysdovhan/vacuum-card/blob/master/CONTRIBUTING.md#how-to-add-translation
[macbury-smart-house]: https://macbury.github.io/SmartHouse/HomeAssistant/Vacuum/
[bbbenji-card]: https://gist.github.com/bbbenji/24372e423f8669b2e6713638d8f8ceb2
[denysdovhan]: https://denysdovhan.com
