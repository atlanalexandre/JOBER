export const C = {
  // Backgrounds
  bg:        "#0A1628",
  bgCard:    "#0D1B3E",
  bgCardAlt: "#112240",
  bgSurface: "#162547",

  // Brand
  violet:    "#7C6FE0",
  violetLight:"#A29BFE",
  violetDark: "#5B4FCF",
  violetGlow: "rgba(123,111,240,0.15)",
  violetGlowStrong: "rgba(123,111,240,0.28)",

  // Accents
  accent:    "#F25E5E",
  accentGold:"#F0B429",
  success:   "#10D98F",
  warning:   "#F0B429",
  danger:    "#F25E5E",

  // Texte
  white:     "#FFFFFF",
  // Contraste vérifié sur les quatre fonds de l'application (#0A1628, #0D1B3E,
  // #112240, #162547). `textMuted` valait #4A4E6A : 1,9:1 sur le fond des
  // cartes, très en dessous des 4,5:1 exigés pour du texte — illisible en plein
  // jour sur un téléphone. Les trois niveaux passent désormais AA partout, tout
  // en restant distincts les uns des autres.
  text:      "#F0F0F5",   // 13,3 à 16,0:1
  textSub:   "#9BA0BA",   //  5,9 à  7,0:1
  textMuted: "#8A90AD",   //  4,8 à  5,8:1

  // Bordures
  border:    "rgba(255,255,255,0.10)",
  borderHover:"rgba(123,111,240,0.35)",
  borderStrong:"rgba(255,255,255,0.18)",

  // Legacy compat
  navy:      "#0A1628",
  navyMid:   "#0D1B3E",
  indigo:    "#162547",
  offWhite:  "#F0F0F5",
  grayLight: "rgba(255,255,255,0.06)",
  gray:      "#9BA0BA",
  textLight: "#9BA0BA",
};

export const font = {
  display: "'Plus Jakarta Sans', 'Inter', system-ui, sans-serif",
  body:    "'Inter', system-ui, sans-serif",
};

export const r = 16;

export const shadow = {
  sm:  "0 2px 8px rgba(0,0,0,0.4)",
  md:  "0 4px 20px rgba(0,0,0,0.5)",
  lg:  "0 8px 40px rgba(0,0,0,0.6)",
  glow:"0 0 30px rgba(123,111,240,0.25)",
  glowStrong:"0 0 50px rgba(123,111,240,0.4)",
};
