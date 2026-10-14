// Eigene kleine Zeichnungen für Tiere, für die es kein passendes Emoji gibt
// (sonst sehen z. B. Kolibri, Pelikan und Möwe alle wie derselbe rote Vogel aus).
const svg = (inhalt) => `<svg viewBox="0 0 64 64" class="tierbild" aria-hidden="true">${inhalt}</svg>`;

export const TIERBILDER = {
  kolibri: svg(`<path d="M22 38c-5 6-11 11-17 13 6-7 9-12 11-17z" fill="#1b7f5a"/>
    <ellipse cx="31" cy="35" rx="12" ry="7.5" transform="rotate(-25 31 35)" fill="#2fbf71"/>
    <path d="M29 31C24 15 30 6 37 3c0 11-2 19-5 28z" fill="#9be7c4" opacity=".9"/>
    <circle cx="41" cy="25" r="6" fill="#2fbf71"/>
    <ellipse cx="40" cy="31" rx="4.5" ry="2.6" fill="#e53935"/>
    <path d="M46 23L63 17 46 26z" fill="#37474f"/>
    <circle cx="43" cy="23.5" r="1.4" fill="#111"/>`),
  pelikan: svg(`<path d="M16 37q-7 7-13 6 6-3 8-10z" fill="#cfd8dc"/>
    <ellipse cx="27" cy="39" rx="15" ry="10.5" fill="#f5f7f8" stroke="#90a4ae" stroke-width="1.2"/>
    <path d="M18 35q9-6 19 0-9 8-19 0z" fill="#b0bec5"/>
    <path d="M37 31q1-13 7-18" stroke="#f5f7f8" stroke-width="7" fill="none" stroke-linecap="round"/>
    <circle cx="45" cy="13" r="6" fill="#f5f7f8" stroke="#90a4ae" stroke-width="1.2"/>
    <path d="M49 11l14 9-14-5z" fill="#ffa000"/>
    <path d="M49 15q7 13 14 5z" fill="#ffcc80"/>
    <circle cx="46.5" cy="11.5" r="1.3" fill="#111"/>
    <path d="M23 49v9m8-9v9" stroke="#ff8f00" stroke-width="2.5" stroke-linecap="round"/>`),
  moewe: svg(`<path d="M3 27q13-11 27 4 14-15 31-6-15-1-26 12h-7Q18 24 3 27z" fill="#90a4ae"/>
    <path d="M3 27l5-3 2 3zm58-2-5-2-1 3z" fill="#263238"/>
    <ellipse cx="31" cy="37" rx="12" ry="5.5" fill="#fff" stroke="#b0bec5" stroke-width="1.2"/>
    <circle cx="42" cy="34" r="4.5" fill="#fff" stroke="#b0bec5" stroke-width="1.2"/>
    <path d="M46 34l8 1.5-8 1.5z" fill="#fbc02d"/>
    <circle cx="43" cy="33" r="1" fill="#111"/>`),
  storch: svg(`<ellipse cx="27" cy="28" rx="13" ry="8" fill="#fff" stroke="#9e9e9e" stroke-width="1.2"/>
    <path d="M15 27q13 10 26 3-6 8-20 6z" fill="#212121"/>
    <path d="M37 25q4-10 9-13" stroke="#9e9e9e" stroke-width="6.5" fill="none" stroke-linecap="round"/>
    <path d="M37 25q4-10 9-13" stroke="#fff" stroke-width="4" fill="none" stroke-linecap="round"/>
    <circle cx="47" cy="11" r="4.5" fill="#fff" stroke="#9e9e9e" stroke-width="1.2"/>
    <path d="M50 10l13 6-13-3z" fill="#e53935"/>
    <circle cx="47.5" cy="10" r="1" fill="#111"/>
    <path d="M24 35l-2 25m9-25 2 25" stroke="#e53935" stroke-width="2.5" stroke-linecap="round"/>`),
  papageitaucher: svg(`<ellipse cx="30" cy="40" rx="14" ry="17" fill="#212121"/>
    <ellipse cx="33" cy="45" rx="9" ry="11.5" fill="#fff"/>
    <circle cx="34" cy="20" r="11" fill="#212121"/>
    <ellipse cx="37" cy="21" rx="7" ry="6" fill="#fafafa"/>
    <path d="M42 15q13 5 0 13z" fill="#ff5722"/>
    <path d="M44 17q3 4 0 9" stroke="#ffd54f" stroke-width="1.6" fill="none"/>
    <circle cx="37" cy="19.5" r="1.5" fill="#111"/>
    <path d="M22 56l-4 5h9zm13 0-2 5h9z" fill="#ff7043"/>`),
  alpendohle: svg(`<path d="M15 36L2 45l15-4z" fill="#263238"/>
    <ellipse cx="28" cy="36" rx="15" ry="10" fill="#263238"/>
    <circle cx="42" cy="26" r="8" fill="#263238"/>
    <path d="M49 25l10 3-10 2z" fill="#fdd835"/>
    <circle cx="44" cy="24" r="1.6" fill="#fff"/>
    <path d="M26 45v11m6-11v11" stroke="#e53935" stroke-width="2.5" stroke-linecap="round"/>`),
  murmeltier: svg(`<ellipse cx="32" cy="43" rx="14" ry="17" fill="#8d6e63"/>
    <ellipse cx="32" cy="47" rx="8" ry="11" fill="#bcaaa4"/>
    <circle cx="25" cy="12" r="3" fill="#6d4c41"/><circle cx="39" cy="12" r="3" fill="#6d4c41"/>
    <circle cx="32" cy="20" r="10" fill="#8d6e63"/>
    <ellipse cx="32" cy="24.5" rx="5" ry="3.5" fill="#d7ccc8"/>
    <circle cx="28" cy="18" r="1.6" fill="#111"/><circle cx="36" cy="18" r="1.6" fill="#111"/>
    <ellipse cx="32" cy="22.5" rx="1.6" ry="1.1" fill="#3e2723"/>
    <rect x="30.5" y="26" width="3" height="3" rx=".5" fill="#fff"/>
    <ellipse cx="24" cy="37" rx="3" ry="5" fill="#6d4c41"/><ellipse cx="40" cy="37" rx="3" ry="5" fill="#6d4c41"/>`),
  pottwal: svg(`<path d="M3 26q0-9 12-9h24q12 0 17 9l6-9v20l-6-7q-6 13-21 13H17Q3 43 3 32z" fill="#546e7a"/>
    <path d="M5 34q14 5 33 1" stroke="#90a4ae" stroke-width="2" fill="none" stroke-linecap="round"/>
    <circle cx="11" cy="26" r="1.6" fill="#111"/>
    <path d="M14 17q-3-6 0-11m0 11q4-5 2-11" stroke="#64b5f6" stroke-width="2" fill="none" stroke-linecap="round"/>`),
  manta: svg(`<path d="M32 17Q20 21 3 34q17 2 25 10l4 15 4-15q8-8 25-10Q44 21 32 17z" fill="#37474f"/>
    <path d="M27 18q-3-6 1-9m9 9q3-6-1-9" stroke="#37474f" stroke-width="3" fill="none" stroke-linecap="round"/>
    <path d="M25 30q7 5 14 0" stroke="#cfd8dc" stroke-width="2" fill="none" stroke-linecap="round"/>
    <circle cx="27" cy="23" r="1.3" fill="#cfd8dc"/><circle cx="37" cy="23" r="1.3" fill="#cfd8dc"/>`),
};

/** Bild eines Tieres: eigene Zeichnung oder Emoji. */
export const tierBild = (t) => TIERBILDER[t?.bild] ?? t?.emoji ?? "";
