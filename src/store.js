import { randomBytes } from "node:crypto";

export class SelectionStore {
  constructor({ ttlMs = 30 * 60 * 1000 } = {}) {
    this.ttlMs = ttlMs;
    this.items = new Map();
  }

  create(payload) {
    this.cleanup();

    const id = randomBytes(8).toString("base64url");
    this.items.set(id, {
      payload,
      expiresAt: Date.now() + this.ttlMs
    });

    return id;
  }

  get(id) {
    const item = this.items.get(id);

    if (!item) {
      return null;
    }

    if (item.expiresAt <= Date.now()) {
      this.items.delete(id);
      return null;
    }

    return item.payload;
  }

  delete(id) {
    this.items.delete(id);
  }

  cleanup() {
    const now = Date.now();

    for (const [id, item] of this.items) {
      if (item.expiresAt <= now) {
        this.items.delete(id);
      }
    }
  }
}
