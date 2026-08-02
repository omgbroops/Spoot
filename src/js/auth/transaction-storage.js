function isStorageLike(storage) {
  return Boolean(
    storage?.getItem &&
      storage?.setItem &&
      storage?.removeItem,
  );
}

export function createOAuthTransactionStorage({
  localStorage,
  sessionStorage,
} = {}) {
  // Prefer the current tab's copy, then fall back to the persistent copy when
  // Spotify returns in a fresh tab or browsing context.
  const storages = [...new Set([sessionStorage, localStorage])]
    .filter(isStorageLike);

  if (!storages.length) {
    throw new TypeError("OAuth requires an available browser storage mechanism.");
  }

  return {
    getItem(key) {
      for (const storage of storages) {
        try {
          const value = storage.getItem(key);
          if (value !== null) return value;
        } catch {}
      }
      return null;
    },

    setItem(key, value) {
      let writes = 0;
      let lastError;
      for (const storage of storages) {
        try {
          storage.setItem(key, value);
          writes += 1;
        } catch (error) {
          lastError = error;
        }
      }
      if (!writes) {
        throw lastError || new Error("The browser could not save the OAuth transaction.");
      }
    },

    removeItem(key) {
      for (const storage of storages) {
        try {
          storage.removeItem(key);
        } catch {}
      }
    },
  };
}
