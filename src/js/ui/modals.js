import { getElements } from './elements.js';

const DEFAULT_TRIGGERS = Object.freeze({
  'dock-search': 'modal-search',
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

  elements.modals.forEach((modal) => setModalClosed(modal, true));

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
    if (!activeModal) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      closeModals();
      return;
    }
    if (event.key !== 'Tab') return;

    const focusable = getFocusable(activeModal);
    if (!focusable.length) {
      event.preventDefault();
      activeModal.setAttribute('tabindex', '-1');
      activeModal.focus({ preventScroll: true });
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && (document.activeElement === first || !activeModal.contains(document.activeElement))) {
      event.preventDefault();
      last.focus({ preventScroll: true });
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus({ preventScroll: true });
    }
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
  setModalClosed(modal, false);
  getElements().scrim?.classList.add('show');
  document.body.classList.add('modal-open');
  requestAnimationFrame(() => modal.querySelector('[data-close], button, input')?.focus({ preventScroll: true }));
  document.dispatchEvent(new CustomEvent('spoot:modal-open', { detail: { id: modal.id } }));
  return true;
}

export function closeModals(options = {}) {
  const modal = activeModal;
  getElements().modals.forEach((item) => {
    item.classList.remove('show');
    setModalClosed(item, true);
  });
  getElements().scrim?.classList.remove('show');
  document.body.classList.remove('modal-open');
  activeModal = undefined;
  if (options.restoreFocus !== false && lastOpener instanceof HTMLElement) lastOpener.focus({ preventScroll: true });
  lastOpener = undefined;
  if (modal) document.dispatchEvent(new CustomEvent('spoot:modal-close', { detail: { id: modal.id } }));
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

function setModalClosed(modal, closed) {
  modal.setAttribute('aria-hidden', String(closed));
  if (closed) modal.setAttribute('inert', '');
  else modal.removeAttribute('inert');
}

function getFocusable(container) {
  return [...container.querySelectorAll(
    'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
  )].filter((element) => !element.hidden && element.getClientRects().length > 0);
}
