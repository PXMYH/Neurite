# Icons

Neurite's icons come from Lucide Static v1.33.0 and are inlined in
`resources/svg/icons.html`. The existing ids are the application interface:
markup and scripts keep referring to those ids while the geometry comes from the
Lucide icon named below.

## Adding or changing an icon

1. Choose an icon from [Lucide](https://lucide.dev/icons/).
2. Copy its geometry into `resources/svg/icons.html`; do not add a runtime
   dependency.
3. Keep the 24×24 Lucide view box, `fill="none"`, a 2-unit stroke, and round caps
   and joins. The 16-unit Node controls also use a 2-unit stroke and are rescaled
   to preserve their optical size.
4. Add or retain a stable sprite id, record its Lucide name with `data-lucide`,
   and update this table and `test/icon-sprite.test.js`.

File tree icons are the only colour exceptions. Their geometry and stroke
language are Lucide, while their established colours continue to distinguish
file types.

## Mapping

| Sprite id | Lucide icon |
| --- | --- |
| `note-icon-symbol` | `sticky-note` |
| `link-icon-symbol` | `link-2` |
| `edges-icon-symbol` | `folder-tree` |
| `ai-icon-symbol` | `bot` |
| `searchSVG` | `search` |
| `plus-icon` | `plus` |
| `delete-icon` | `trash-2` |
| `gear-icon` | `settings` |
| `fractal-icon` | `orbit` |
| `question-mark` | `circle-question-mark` |
| `play-icon` | `send` |
| `refresh-icon` | `rotate-cw` |
| `pause-icon` | `pause` |
| `function-button` | `chevrons-up-down` |
| `eyeball-symbol` | `eye` |
| `crossed-eyeball-symbol` | `eye-off` |
| `folder-icon` | `folder` |
| `folder-open-icon` | `folder-open` |
| `folder-plus-icon` | `folder-plus` |
| `file-text-icon` | `file-text` |
| `file-image-icon` | `file-image` |
| `file-code-icon` | `file-code` |
| `file-csv-icon` | `file-spreadsheet` |
| `file-pdf-icon` | `file-text` |
| `file-audio-icon` | `file-music` |
| `file-video-icon` | `file-video-camera` |
| `file-zip-icon` | `file-archive` |
| `file-exe-icon` | `file-terminal` |
| `caret-left-icon` | `chevron-left` |
| `caret-right-icon` | `chevron-right` |
| `refresh-button` | `rotate-cw` |
| `chevron-down-icon` | `chevron-down` |
| `copy-icon-template` | `copy` |
| `download-icon` | `download` |
| `aiNodeSettingsIcon` | `sliders-horizontal` |
| `funcErrorIcon` | `circle-alert` |
| `expand-icon` | `maximize-2` |
| `button-collapse` | `minimize-2` |
| `button-fullscreen` | `maximize` |
| `button-delete` | `x` |

## Licence notices

Lucide Static v1.33.0 is distributed under the ISC License:

> Copyright (c) 2026 Lucide Icons and Contributors
>
> Permission to use, copy, modify, and/or distribute this software for any
> purpose with or without fee is hereby granted, provided that the above
> copyright notice and this permission notice appear in all copies.
>
> THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
> WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
> MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY
> SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER
> RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT,
> NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE
> USE OR PERFORMANCE OF THIS SOFTWARE.

Lucide identifies some of the icons used here as derived from Feather Icons,
which are distributed under the MIT License:

> Copyright (c) 2013-present Cole Bemis
>
> Permission is hereby granted, free of charge, to any person obtaining a copy
> of this software and associated documentation files (the "Software"), to deal
> in the Software without restriction, including without limitation the rights
> to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
> copies of the Software, and to permit persons to whom the Software is
> furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all
> copies or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
> IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
> FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
> AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
> LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
> OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
> SOFTWARE.
