# ADR-025: Keep map symbols fixed and label each drainage area once

## Status

Accepted

## Date

2026-08-14

## Context

ADR-022 made reservoir circles grow as the ArcGIS 5.1 map zoomed in. The
intent was to reveal sites whose points nearly coincide. In the working map,
the rule produced the opposite result: every geographic step that separated
nearby points also enlarged their symbols, up to three times the opening
diameter. Dense reservoir groups remained covered and eventually became less
readable than they were at the regional view.

The opening view had a second problem. The map component received the region
extent before it received the space occupied by the storage panel. The legacy
MapView supplies both in its constructor. Supplying the panel padding only
after the 5.1 view was ready meant the initial extent was resolved against
space the reader could not see.

The drainage areas were graphics with no label layer. A direct conversion of
each polygon to a labeled feature would repeat the same name for any
multi-part drainage area.

## Decision

Keep reservoir symbols fixed in screen pixels at every zoom level. The map
continues to size rings by the square root of reservoir capacity, keeps small
reservoirs above large neighbours, and sizes the fill by the square root of
the stored percentage. The primary map narrows the ring range from 8–46 pixels
to 8–36 pixels. It does not use `$view.scale` in a size expression.

Set the shell panel padding on the ArcGIS map component before assigning the
opening extent. Keep the same drainage-derived regional extent, navigation
geometry, minimum zoom, maximum zoom, and Home target used by the comparison
maps. Read the effective constraint state from the ready view instead of
reporting only the requested values.

Build the drainage context as a client-side feature layer with one multipart
feature per six-digit drainage area. Apply one name-label class to that layer,
visible at regional scales of 1:10,000,000 and closer. One feature per area
means one label candidate per area even when its geometry has disconnected
parts.

## Alternatives Considered

### Keep the zoom factor but lower its ceiling

- Rejected: it reduces the symptom but keeps symbol growth fighting the
  geographic separation that zoom is meant to provide.

### Shrink every reservoir to the same size

- Rejected: the ring would stop carrying physical reservoir size, one of the
  map's two primary quantities.

### Add one text graphic for every polygon part

- Rejected: multipart drainage areas would repeat their name. A label engine
  over one feature per area provides placement and avoids duplicate sources.

## Consequences

- Zooming in separates reservoir centres while their screen footprint stays
  stable.
- The largest opening symbol is about 22% narrower before removal of the old
  zoom multiplier is considered.
- The initial regional extent is resolved inside the visible map area rather
  than behind the storage panel.
- Every drainage area has one label source and one label class. The ArcGIS
  label engine can still suppress a label temporarily when no collision-free
  placement exists.
- ADR-022 is superseded.
