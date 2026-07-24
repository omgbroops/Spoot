import { getElements } from './elements.js';

const DEFAULT_TRIGGERS = Object.freeze({
  'dock-library': 'modal-library',
  'dock-import': 'modal-import',
  'dock-eq': 'modal-eq',
  'dock-settings': 'modal-settings',
});

let activeModal;
let lastOpener;
let cleanup;

export function setupModals(options = {}) {
  cleanup?.();
  const elements = getElements();
  const triggerMap = { ...DEFAULT_TRIGGERS, ...(options.triggers || {}) };
  const removeListeners = [];

  elements.modals.forEach((modal) => modal.setAttribute('aria-hidden', 'true'));

  Object.entries(triggerMap).forEach(([triggerId, modalId]) => {
    const trigger = document.getElementById(triggerId);
    if (!trigger) return;
    const listener = (event) => {
      event.preventDefault();
      if (activeModal?.id === modalId) closeModals();
      else openModal(modalId, { opener: trigger });
    };
    trigger.addEventListener('click', listener);
    removeListeners.push(() => trigger.removeEventListener('click', listener));
  });

  document.querySelectorAll('[data-close]').forEach((button) => {
    const listener = () => closeModals();
    button.addEventListener('click', listener);
    removeListeners.push(() => button.removeEventListener('click', listener));
  });

  const onScrim = () => closeModals();
  const onKeyDown = (event) => {
    if (event.key !== 'Escape' || !activeModal) return;
    event.preventDefault();
    closeModals();
  };
  elements.scrim?.addEventListener('click', onScrim);
  window.addEventListener('keydown', onKeyDown);

  cleanup = () => {
    removeListeners.forEach((remove) => remove());
    elements.scrim?.removeEventListener('click', onScrim);
    window.removeEventListener('keydown', onKeyDown);
    cleanup = undefined;
  };
  return cleanup;
}

export function openModal(idOrElement, options = {}) {
  const modal = typeof idOrElement === 'string' ? document.getElementById(idOrElement) : idOrElement;
  if (!modal?.classList.contains('modal') || document.body.classList.contains('hidden-mode')) return false;
  closeModals({ restoreFocus: false });
  lastOpener = options.opener || document.activeElement;
  activeModal = modal;
  modal.style.removeProperty('left');
  modal.style.removeProperty('top');
  modal.style.removeProperty('margin');
  modal.style.removeProperty('transform');
  modal.classList.add('show');
  modal.setAttribute('aria-hidden', 'false');
  getElements().scrim?.classList.add('show');
  document.body.classList.add('modal-open');
  requestAnimationFrame(() => modal.querySelector('[data-close], button, input')?.focus({ preventScroll: true }));
  document.dispatchEvent(new CustomEvent('spool:modal-open', { detail: { id: modal.id } }));
  return true;
}

export function closeModals(options = {}) {
  const modal = activeModal;
  getElements().modals.forEach((item) => {
    item.classList.remove('show');
    item.setAttribute('aria-hidden', 'true');
  });
  getElements().scrim?.classList.remove('show');
  document.body.classList.remove('modal-open');
  activeModal = undefined;
  if (options.restoreFocus !== false && lastOpener instanceof HTMLElement) lastOpener.focus({ preventScroll: true });
  lastOpener = undefined;
  if (modal) document.dispatchEvent(new CustomEvent('spool:modal-close', { detail: { id: modal.id } }));
}

export function toggleModal(idOrElement, options = {}) {
  const modal = typeof idOrElement === 'string' ? document.getElementById(idOrElement) : idOrElement;
  if (modal && activeModal === modal) {
    closeModals();
    return false;
  }
  return openModal(modal, options);
}

export function getOpenModal() {
  return activeModal;
}

export function isModalOpen(id) {
  return Boolean(activeModal && (!id || activeModal.id === id));
}
