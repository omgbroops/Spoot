import { showToast } from './toast.js';

const DEFAULT_SUFFIX = 'is not connected in this pass.';
let teardown;

export function inactiveFeatureMessage(feature) {
  const name = String(feature || 'This feature').trim();
  return `${name} ${DEFAULT_SUFFIX}`;
}

export function explainInactiveFeature(feature) {
  const message = inactiveFeatureMessage(feature);
  showToast(message);
  return message;
}

export function markInactive(element, feature) {
  if (!element) return element;
  const name = feature || element.dataset.inactiveFeature || 'This feature';
  element.dataset.inactiveFeature = name;
  element.classList.add('inactive-control');
  element.setAttribute('aria-disabled', 'true');
  element.title = inactiveFeatureMessage(name);
  return element;
}

export function setupInactiveFeatures(root = document) {
  teardown?.();

  const inactive = [...root.querySelectorAll('[data-inactive-feature]')];
  inactive.forEach((element) => {
    const feature = element.dataset.inactiveFeature || 'This feature';
    element.setAttribute('aria-disabled', 'true');
    if (!element.title) element.title = inactiveFeatureMessage(feature);
  });

  const activate = (event) => {
    const target = event.target instanceof Element
      ? event.target.closest('[data-inactive-feature]')
      : null;
    if (!target || !root.contains(target)) return;
    event.preventDefault();
    event.stopPropagation();
    explainInactiveFeature(target.dataset.inactiveFeature);
  };

  const onKeyDown = (event) => {
    if (event.key === 'Enter' || event.key === ' ') activate(event);
  };

  root.addEventListener('click', activate, true);
  root.addEventListener('keydown', onKeyDown, true);
  teardown = () => {
    root.removeEventListener('click', activate, true);
    root.removeEventListener('keydown', onKeyDown, true);
    teardown = undefined;
  };
  return teardown;
}
