import type { TreeNode } from '../data/types';
import { LIQUID_EMOTIONS } from '../data/liquidEmotions';
import { palette } from './theme';
import './InstillingInfo.css';

/** Informational only: no item state or allocation controls. */
export default function InstillingInfo({ node }: Readonly<{ node: TreeNode }>) {
  return <div className="instilling-info" style={{ borderColor: palette.border, color: palette.textMetal }}>
    <div className="instilling-info-title" style={{ color: palette.textTitle }}>Instilling only</div>
    <p>Granted by an item instilment. Cannot be allocated with passive points.</p>
    {!!node.recipe?.length && <>
      <div className="instilling-info-label" style={{ color: palette.textMuted }}>Liquid Emotions · in order</div>
      <ol aria-label="Instilling recipe">
        {node.recipe.map((id, index) => {
          const liquid = LIQUID_EMOTIONS[id];
          return <li key={`${index}:${id}`}>
            <span className="instilling-step" aria-hidden="true">{index + 1}.</span>
            {liquid && <img src={`${import.meta.env.BASE_URL}liquid-emotions/${liquid.icon}`}
              width="32" height="32" alt="" />}
            <span>{liquid?.name ?? id.replace(/([a-z])([A-Z])/g, '$1 $2')}</span>
          </li>;
        })}
      </ol>
    </>}
  </div>;
}
