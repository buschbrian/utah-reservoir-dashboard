/*
 * The names this roster used to carry, and the station each one became.
 *
 * Twenty-six provider names were normalized on 2026-08-22 under ADR-079 --
 * operator parentheticals removed, gauge abbreviations expanded, plant
 * numbering replaced by the water's own name. The rulings live in
 * `names-worksheet.csv`; this module is what keeps every link written
 * against the old spelling working.
 *
 * Embedded rather than fetched for the same reason `public/retired-route.js`
 * embeds its URL translations: a former name is part of the site's link
 * contract, not an observation about the world, and resolving one must not
 * cost a request or an async hop inside a synchronous lookup.
 *
 * Keys are lowercased old names; values are station ids (ADR-066).
 */
export const FORMER_NAMES: Readonly<Record<string, string>> = Object.freeze({
  "mossyrock dam (riffe lk)": "14234800:WA:BOR",
  "new exchequer-lk mcclure": "EXC",
  "warm springs (lake sonoma)": "WRS",
  "hell hole (pcwa)": "HHL",
  "courtright (pg&e)": "CTG",
  "coyote (lake mendocino)": "COY",
  "hidden dam (hensley)": "HID",
  "huntington lake (usbr)": "HNT",
  "lake davis (dwr)": "DAV",
  "lake pillsbury nr potter vly 24hr avg": "LPY",
  "englebright (usace)": "ENG",
  "loon lake (smud)": "LON",
  "florence lake (sce)": "FLR",
  "ice house (smud)": "ICH",
  "viva naughton res": "09223100:WY:BOR",
  "pit r no 7 reservoir": "PT7",
  "santiago creek res (irvine lake)": "SGC",
  "coyote res-sta clara": "CYC",
  "caples lake (eid)": "CPL",
  "stumpy meadows reservoir(mark edson dam)": "EDN",
  "gem  lake": "GLK",
  "pit r no 6 reservoir": "PT6",
  "thompson falls res": "12390000:MT:BOR",
  "marlette lk nr carson city": "10336710:NV:BOR",
  "nevada creek res": "12336500:MT:BOR",
  "lake natoma  (nimbus dam)": "NAT"
});
