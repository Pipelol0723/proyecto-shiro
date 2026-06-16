# Shiro UI Kit — how to build with it

Shiro is a VTuber-style AI companion. This kit ships its real components on
`window.ShiroUI` and its visual language as CSS custom properties. Build
on-brand by **wrapping in a theme class and styling layout with the tokens
below** — never invent ad-hoc colors or fonts.

## Wrapping & setup (required)

Every screen must live under one theme class on an ancestor — that is where
all color and font tokens are defined. Without it the tokens are unset: the
`Orb` renders black and text falls back to a system font.

```jsx
// pick ONE theme on a root wrapper; everything inside inherits the tokens
<div className="theme-kawaii" style={{ background: 'var(--bg)', backgroundImage: 'var(--bg-grad)', color: 'var(--ink)', fontFamily: 'var(--font-body)' }}>
  <ShiroUI.Orb emotion="divertida" speaking size={180} />
</div>
```

The three themes are `theme-kawaii` (pink pastel), `theme-cyber` (dark neon),
`theme-editorial` (cream/serif). `ThemeSwitcher` is the control that swaps
them (it sets `theme-<name>` on `document.body`).

## Styling idiom: CSS custom properties (`var(--*)`)

There are **no utility classes and no styling props** — you style your own
layout with these tokens (all defined per theme, so they adapt automatically):

| Family | Tokens |
|---|---|
| Surface / bg | `--bg`, `--bg-grad`, `--surface`, `--surface-solid`, `--surface-border`, `--surface-hover` |
| Text | `--ink`, `--ink-mute`, `--ink-faint` |
| Accent | `--accent`, `--accent-soft`, `--accent-2` |
| Emotion (Orb) | `--neutral-color`, `--divertida-color`, `--pensativa-color`, `--molesta-color`, `--vulnerable-color`, `--orb-halo` |
| Radius | `--radius-sm` (8) `--radius-md` (14) `--radius-lg` (22) `--radius-xl` (32) |
| Fonts | `--font-display`, `--font-body`, `--font-mono` |
| Elevation | `--shadow-md`, `--shadow-lg` |
| Easing | `--ease-out`, `--ease-in-out` |

Icons (`IconChat`, `IconModules`, `IconCharacter`, `IconAvatar`, `IconSetup`,
`IconMic`, `IconSend`) are line glyphs that draw in `currentColor` and take a
`size` prop — set their color via the parent's `color` (e.g. `var(--accent)`).

## Where the truth lives

- `styles.css` (it `@import`s `_ds_bundle.css`) — every token definition, per
  theme. Read it before styling.
- `components/<group>/<Name>/<Name>.prompt.md` + `.d.ts` — per-component API
  and usage.

## One idiomatic snippet

```jsx
// A companion chat header, on-brand, no hard-coded colors
<header className="theme-kawaii" style={{ display: 'flex', alignItems: 'center', gap: 16, padding: 16, background: 'var(--surface)', border: '1px solid var(--surface-border)', borderRadius: 'var(--radius-lg)', color: 'var(--ink)', fontFamily: 'var(--font-body)', boxShadow: 'var(--shadow-md)' }}>
  <ShiroUI.Orb emotion="neutral" size={56} />
  <div style={{ flex: 1 }}>
    <div style={{ fontFamily: 'var(--font-display)', fontWeight: 600 }}>Shiro</div>
    <div style={{ color: 'var(--ink-mute)', fontSize: 13 }}>online</div>
  </div>
  <span style={{ color: 'var(--accent)' }}><ShiroUI.IconMic size={22} /></span>
</header>
```
