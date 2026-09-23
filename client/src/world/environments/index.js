import NightForest from './night-forest/NightForest.jsx';

// asset_config.kind -> scene component. Add the Island here once it is built.
const SCENES = {
  night_forest: NightForest,
};

export function getSceneComponent(kind) {
  return SCENES[kind] ?? null;
}

export function isEnvironmentPlayable(environment) {
  return environment.assetConfig?.available !== false && Boolean(SCENES[environment.assetConfig?.kind]);
}
