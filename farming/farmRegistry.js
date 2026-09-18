/**
 * Persistent farm registry — saved to data/farms.json
 */

const fs = require("fs");
const path = require("path");
const { EventEmitter } = require("events");

const DATA_DIR = path.join(__dirname, "..", "data");
const DATA_FILE = path.join(DATA_DIR, "farms.json");

class FarmRegistry extends EventEmitter {
  constructor() {
    super();
    /** @type {Array} */
    this._farms = [];
    this._enabled = true;
    this._currentFarmId = null;
    this._nextId = 1;
    this.load();
  }

  load() {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      if (!fs.existsSync(DATA_FILE)) {
        this._farms = [];
        this._enabled = true;
        this.save();
        return;
      }
      const raw = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
      this._farms = Array.isArray(raw.farms) ? raw.farms : [];
      this._enabled = raw.enabled !== false;
      this._nextId =
        this._farms.reduce((max, f) => Math.max(max, f.id || 0), 0) + 1;
    } catch (e) {
      console.warn("[Farms] Failed to load registry:", e.message);
      this._farms = [];
      this._enabled = true;
    }
  }

  save() {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      fs.writeFileSync(
        DATA_FILE,
        JSON.stringify(
          {
            enabled: this._enabled,
            farms: this._farms,
          },
          null,
          2
        )
      );
      this.emit("farms:updated", this.getPublicState());
    } catch (e) {
      console.warn("[Farms] Failed to save registry:", e.message);
    }
  }

  getFarms() {
    return [...this._farms];
  }

  getActiveFarms() {
    return this._farms.filter((f) => f.status === "active");
  }

  getFarm(id) {
    return this._farms.find((f) => f.id === id) || null;
  }

  isEnabled() {
    return this._enabled;
  }

  setEnabled(enabled) {
    this._enabled = !!enabled;
    this.save();
  }

  getCurrentFarmId() {
    return this._currentFarmId;
  }

  setCurrentFarmId(id) {
    this._currentFarmId = id;
    this.emit("farms:updated", this.getPublicState());
  }

  addFarm(farm) {
    const entry = {
      id: this._nextId++,
      crop: farm.crop,
      origin: farm.origin,
      bounds: farm.bounds,
      chestPos: farm.chestPos || null,
      lastTendedAt: farm.lastTendedAt || 0,
      status: farm.status || "active",
      createdAt: Date.now(),
    };
    this._farms.push(entry);
    this.save();
    return entry;
  }

  updateFarm(id, patch) {
    const farm = this.getFarm(id);
    if (!farm) return null;
    Object.assign(farm, patch);
    this.save();
    return farm;
  }

  removeFarm(id) {
    const idx = this._farms.findIndex((f) => f.id === id);
    if (idx < 0) return false;
    this._farms.splice(idx, 1);
    if (this._currentFarmId === id) this._currentFarmId = null;
    this.save();
    return true;
  }

  /**
   * Next farm to tend: oldest lastTendedAt among active, respecting min interval.
   */
  pickNextFarm(minIntervalMs) {
    const active = this.getActiveFarms();
    if (!active.length) return null;

    const sorted = [...active].sort(
      (a, b) => (a.lastTendedAt || 0) - (b.lastTendedAt || 0)
    );
    const candidate = sorted[0];
    const elapsed = Date.now() - (candidate.lastTendedAt || 0);
    if (candidate.lastTendedAt > 0 && elapsed < minIntervalMs) {
      return null; // too soon
    }
    return candidate;
  }

  formatStatusChat() {
    if (!this._farms.length) {
      return "I don't have any farms yet. Say 'make a wheat farm here' or 'tend this farm'.";
    }
    const pause = this._enabled ? "" : " (farming paused)";
    const lines = this._farms.map((f) => {
      const ago = f.lastTendedAt
        ? `${Math.round((Date.now() - f.lastTendedAt) / 60000)}m ago`
        : "never";
      return `#${f.id} ${f.crop} @ ${Math.floor(f.origin.x)},${Math.floor(f.origin.y)},${Math.floor(f.origin.z)} (tended ${ago})`;
    });
    return `Farms${pause}: ${lines.join("; ")}`;
  }

  getPublicState() {
    return {
      enabled: this._enabled,
      currentFarmId: this._currentFarmId,
      farms: this.getFarms().map((f) => ({
        id: f.id,
        crop: f.crop,
        origin: f.origin,
        chestPos: f.chestPos,
        lastTendedAt: f.lastTendedAt,
        status: f.status,
      })),
      farmCount: this._farms.length,
    };
  }
}

const farmRegistry = new FarmRegistry();

module.exports = {
  farmRegistry,
  FarmRegistry,
  DATA_FILE,
};
