import { CARD_BACKGROUNDS, LEGACY_BACKGROUND_ALIASES } from './card-backgrounds.mjs';

export const CARD_STYLE_OPTIONS = Object.freeze({
  theme: ['orange', 'mint', 'ink', 'sand', 'rose', 'sky'],
  layout: ['standard', 'poster', 'note'],
  radius: ['soft', 'square'],
  emphasis: ['normal', 'bold'],
  background: ['none', ...Object.keys(CARD_BACKGROUNDS), ...Object.keys(LEGACY_BACKGROUND_ALIASES)],
  shape: ['standard', 'ticket', 'polaroid', 'bubble'],
  coverPosition: ['center','top','bottom','left','right']
});
export const DEFAULT_CARD_STYLE = Object.freeze({theme:'orange', layout:'standard', radius:'soft', emphasis:'normal', background:'none', shape:'standard',coverPosition:'center'});

export function isCardStyle(value, {partial=false}={}) {
  if (!value || typeof value!=='object' || Array.isArray(value)) return false;
  if (Object.keys(value).some(key=>!CARD_STYLE_OPTIONS[key]?.includes(value[key]))) return false;
  // Previously saved four-field styles remain valid; missing background means none.
  return partial || Object.keys(CARD_STYLE_OPTIONS).filter(key=>!['background','shape','coverPosition'].includes(key)).every(key=>key in value);
}

export function normalizeCardStyle(value) {
  return isCardStyle(value, {partial:true}) ? {...DEFAULT_CARD_STYLE,...value} : {...DEFAULT_CARD_STYLE};
}
