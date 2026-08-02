export class SessionCache {
  constructor({ maxEntries = 32 } = {}) {
    if (!Number.isInteger(maxEntries) || maxEntries < 1) {
      throw new RangeError("Session cache maxEntries must be a positive integer.");
    }
    this.maxEntries = maxEntries;
    this.entries = new Map();
  }

  get size() {
    return this.entries.size;
  }

  has(key) {
    return this.entries.has(key);
  }

  get(key) {
    if (!this.entries.has(key)) return undefined;
    const value = this.entries.get(key);
    this.entries.delete(key);
    this.entries.set(key, value);
    return value;
  }

  set(key, value) {
    if (this.entries.has(key)) this.entries.delete(key);
    this.entries.set(key, value);
    while (this.entries.size > this.maxEntries) {
      this.entries.delete(this.entries.keys().next().value);
    }
    return value;
  }

  delete(key) {
    return this.entries.delete(key);
  }

  clear() {
    this.entries.clear();
  }
}
